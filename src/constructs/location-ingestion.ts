import { DataAwsIotEndpoint } from '@cdktf/provider-aws/lib/data-aws-iot-endpoint';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { IotTopicRule } from '@cdktf/provider-aws/lib/iot-topic-rule';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { Construct } from 'constructs';
import * as crypto from 'crypto';

export interface LocationIngestionProps {
  provider: AwsProvider;
  driverCount: number;
  dynamoTableName: string;
  dynamoTableArn: string;
  environment: string;
  maxThroughput: number;
}

export class LocationIngestion extends Construct {
  public readonly iotEndpoint: string;
  public readonly processorFunctionArn: string;

  constructor(scope: Construct, id: string, props: LocationIngestionProps) {
    super(scope, id);

    // Get IoT endpoint
    const iotEndpoint = new DataAwsIotEndpoint(this, 'iot-endpoint', {
      provider: props.provider,
      endpointType: 'iot:Data-ATS',
    });

    // Create deployment bucket for Lambda code
    const deploymentBucket = new S3Bucket(this, 'deployment-bucket', {
      provider: props.provider,
      bucket: `location-processor-deployment-${props.environment}-${crypto.randomBytes(4).toString('hex')}`,
      forceDestroy: true,
    });

    // Lambda execution role
    const lambdaRole = new IamRole(this, 'lambda-role', {
      provider: props.provider,
      namePrefix: `location-processor-role-${props.environment}-`,
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Principal: { Service: 'lambda.amazonaws.com' },
            Effect: 'Allow',
          },
        ],
      }),
    });

    // Lambda policy for DynamoDB and CloudWatch
    new IamRolePolicy(this, 'lambda-policy', {
      provider: props.provider,
      role: lambdaRole.id,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:ConditionCheckItem',
            ],
            Resource: props.dynamoTableArn,
          },
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ],
            Resource: 'arn:aws:logs:*:*:*',
          },
        ],
      }),
    });

    // Upload Lambda code
    const lambdaZip = new S3Object(this, 'lambda-zip', {
      provider: props.provider,
      bucket: deploymentBucket.id,
      key: 'location-processor.zip',
      source: '../../../lib/lambda/location-processor.zip',
    });

    // Location processor Lambda
    const processorFunction = new LambdaFunction(this, 'processor-function', {
      provider: props.provider,
      functionName: `location-processor-${props.environment}`,
      role: lambdaRole.arn,
      handler: 'index.handler',
      runtime: 'nodejs20.x',
      s3Bucket: deploymentBucket.id,
      s3Key: lambdaZip.key,
      timeout: 3,
      memorySize: 3008,
      reservedConcurrentExecutions: Math.min(
        50,
        Math.ceil(props.maxThroughput / 100)
      ),
      environment: {
        variables: {
          DYNAMO_TABLE_NAME: props.dynamoTableName,
          MAX_WRITE_LATENCY_MS: '50',
        },
      },
    });

    // IoT Rule for location updates
    const locationRule = new IotTopicRule(this, 'location-rule', {
      provider: props.provider,
      name: `driver_location_updates_${props.environment}`,
      enabled: true,
      sql: "SELECT * FROM 'driver/+/location'",
      sqlVersion: '2016-03-23',
      lambda: [
        {
          functionArn: processorFunction.arn,
        },
      ],
    });

    // Grant IoT permission to invoke Lambda
    new LambdaPermission(this, 'iot-lambda-permission', {
      provider: props.provider,
      action: 'lambda:InvokeFunction',
      functionName: processorFunction.functionName,
      principal: 'iot.amazonaws.com',
      sourceArn: locationRule.arn,
    });

    this.iotEndpoint = iotEndpoint.endpointAddress;
    this.processorFunctionArn = processorFunction.arn;
  }
}
