import { CloudwatchLogGroup } from '@cdktf/provider-aws/lib/cloudwatch-log-group';
import { ElasticacheReplicationGroup } from '@cdktf/provider-aws/lib/elasticache-replication-group';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { KinesisStream } from '@cdktf/provider-aws/lib/kinesis-stream';
import { LambdaEventSourceMapping } from '@cdktf/provider-aws/lib/lambda-event-source-mapping';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { SecurityGroup } from '@cdktf/provider-aws/lib/security-group';
import { SqsQueue } from '@cdktf/provider-aws/lib/sqs-queue';
import { Subnet } from '@cdktf/provider-aws/lib/subnet';
import { Construct } from 'constructs';

export interface StreamProcessingProps {
  providers: Map<string, AwsProvider>;
  regions: string[];
  dynamoStreamArns: Map<string, string>;
  elastiCacheClusters: Map<string, ElasticacheReplicationGroup>;
  neptuneEndpoints: Map<string, string>;
  privateSubnets: Map<string, Subnet[]>;
  lambdaSecurityGroups: Map<string, SecurityGroup>;
  environment: string;
}

export class StreamProcessing extends Construct {
  public readonly kinesisStreamArns: Map<string, string>;
  public readonly kinesisStreamNames: Map<string, string>;
  public readonly cacheUpdaterFunctions: Map<string, string>;
  public readonly graphUpdaterFunctions: Map<string, string>;

  constructor(scope: Construct, id: string, props: StreamProcessingProps) {
    super(scope, id);

    this.kinesisStreamArns = new Map();
    this.kinesisStreamNames = new Map();
    this.cacheUpdaterFunctions = new Map();
    this.graphUpdaterFunctions = new Map();

    props.providers.forEach((provider, region) => {
      // Dead Letter Queue for cache updater
      const cacheUpdaterDLQ = new SqsQueue(
        this,
        `cache-updater-dlq-${region}`,
        {
          provider,
          name: `${props.environment}-cache-updater-dlq-${region}`,
          messageRetentionSeconds: 1209600, // 14 days
          tags: {
            Environment: props.environment,
            Region: region,
          },
        }
      );

      // Dead Letter Queue for graph updater
      const graphUpdaterDLQ = new SqsQueue(
        this,
        `graph-updater-dlq-${region}`,
        {
          provider,
          name: `${props.environment}-graph-updater-dlq-${region}`,
          messageRetentionSeconds: 1209600,
          tags: {
            Environment: props.environment,
            Region: region,
          },
        }
      );

      // CloudWatch log group for cache updater
      const cacheUpdaterLogGroup = new CloudwatchLogGroup(
        this,
        `cache-updater-logs-${region}`,
        {
          provider,
          name: `/aws/lambda/${props.environment}-cache-updater-${region}`,
          retentionInDays: props.environment === 'dev' ? 7 : 30,
          kmsKeyId: undefined,
          tags: {
            Environment: props.environment,
            Region: region,
          },
        }
      );

      // CloudWatch log group for graph updater
      const graphUpdaterLogGroup = new CloudwatchLogGroup(
        this,
        `graph-updater-logs-${region}`,
        {
          provider,
          name: `/aws/lambda/${props.environment}-graph-updater-${region}`,
          retentionInDays: props.environment === 'dev' ? 7 : 30,
          kmsKeyId: undefined,
          tags: {
            Environment: props.environment,
            Region: region,
          },
        }
      );

      // Kinesis stream for location updates
      const kinesisStream = new KinesisStream(this, `kinesis-${region}`, {
        provider,
        name: `driver-location-stream-${region}-${props.environment}`,
        shardCount: 10,
        retentionPeriod: 24,
        shardLevelMetrics: ['IncomingRecords', 'OutgoingRecords'],
        encryptionType: 'KMS',
        kmsKeyId: 'alias/aws/kinesis',
        tags: {
          Environment: props.environment,
          Region: region,
        },
      });

      this.kinesisStreamArns.set(region, kinesisStream.arn);
      this.kinesisStreamNames.set(region, kinesisStream.name);

      // Lambda role for cache updater
      const cacheUpdaterRole = new IamRole(
        this,
        `cache-updater-role-${region}`,
        {
          provider,
          namePrefix: `cache-updater-role-${region}-${props.environment}-`,
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
        }
      );

      // Cache updater Lambda policy
      new IamRolePolicy(this, `cache-updater-policy-${region}`, {
        provider,
        role: cacheUpdaterRole.id,
        policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'dynamodb:DescribeStream',
                'dynamodb:GetRecords',
                'dynamodb:GetShardIterator',
                'dynamodb:ListStreams',
              ],
              Resource: props.dynamoStreamArns.get(region)!,
            },
            {
              Effect: 'Allow',
              Action: ['kinesis:PutRecord', 'kinesis:PutRecords'],
              Resource: kinesisStream.arn,
            },
            {
              Effect: 'Allow',
              Action: [
                'elasticache:DescribeReplicationGroups',
                'elasticache:DescribeCacheClusters',
              ],
              Resource: '*',
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
            {
              Effect: 'Allow',
              Action: [
                'ec2:CreateNetworkInterface',
                'ec2:DescribeNetworkInterfaces',
                'ec2:DeleteNetworkInterface',
              ],
              Resource: '*',
            },
            {
              Effect: 'Allow',
              Action: ['sqs:SendMessage'],
              Resource: cacheUpdaterDLQ.arn,
            },
          ],
        }),
      });

      // Cache updater Lambda
      const cacheUpdaterFunction = new LambdaFunction(
        this,
        `cache-updater-${region}`,
        {
          provider,
          functionName: `cache-updater-${region}-${props.environment}`,
          role: cacheUpdaterRole.arn,
          handler: 'index.handler',
          runtime: 'nodejs20.x',
          timeout: 5,
          memorySize: 1024,
          reservedConcurrentExecutions: 20,
          environment: {
            variables: {
              ELASTICACHE_ENDPOINT:
                props.elastiCacheClusters.get(region)!
                  .configurationEndpointAddress,
              KINESIS_STREAM_NAME: kinesisStream.name,
              REGION: region,
              UPDATE_DEADLINE_MS: '2000',
            },
          },
          filename: '../../../lib/placeholder.zip',
          vpcConfig: {
            subnetIds: props.privateSubnets.get(region)!.map(s => s.id),
            securityGroupIds: [props.lambdaSecurityGroups.get(region)!.id],
          },
          tracingConfig: {
            mode: 'Active',
          },
          deadLetterConfig: {
            targetArn: cacheUpdaterDLQ.arn,
          },
          dependsOn: [
            cacheUpdaterLogGroup,
            props.elastiCacheClusters.get(region)!,
          ],
        }
      );

      this.cacheUpdaterFunctions.set(region, cacheUpdaterFunction.functionName);

      // DynamoDB Streams trigger for cache updater
      if (props.dynamoStreamArns.has(region)) {
        new LambdaEventSourceMapping(this, `dynamo-trigger-${region}`, {
          provider,
          functionName: cacheUpdaterFunction.arn,
          eventSourceArn: props.dynamoStreamArns.get(region)!,
          startingPosition: 'LATEST',
          maximumBatchingWindowInSeconds: 1,
          parallelizationFactor: 10,
          maximumRecordAgeInSeconds: 60,
        });
      }

      // Lambda role for graph updater
      const graphUpdaterRole = new IamRole(
        this,
        `graph-updater-role-${region}`,
        {
          provider,
          namePrefix: `graph-updater-role-${region}-${props.environment}-`,
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
        }
      );

      // Graph updater Lambda policy
      new IamRolePolicy(this, `graph-updater-policy-${region}`, {
        provider,
        role: graphUpdaterRole.id,
        policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'kinesis:DescribeStream',
                'kinesis:GetRecords',
                'kinesis:GetShardIterator',
                'kinesis:ListStreams',
              ],
              Resource: kinesisStream.arn,
            },
            {
              Effect: 'Allow',
              Action: ['neptune-db:*'],
              Resource: '*',
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
            {
              Effect: 'Allow',
              Action: [
                'ec2:CreateNetworkInterface',
                'ec2:DescribeNetworkInterfaces',
                'ec2:DeleteNetworkInterface',
              ],
              Resource: '*',
            },
            {
              Effect: 'Allow',
              Action: ['sqs:SendMessage'],
              Resource: graphUpdaterDLQ.arn,
            },
          ],
        }),
      });

      // Graph updater Lambda
      const graphUpdaterFunction = new LambdaFunction(
        this,
        `graph-updater-${region}`,
        {
          provider,
          functionName: `graph-updater-${region}-${props.environment}`,
          role: graphUpdaterRole.arn,
          handler: 'index.handler',
          runtime: 'nodejs20.x',
          timeout: 10,
          memorySize: 3008,
          reservedConcurrentExecutions: 20,
          environment: {
            variables: {
              NEPTUNE_ENDPOINT: props.neptuneEndpoints.get(region)!,
              NEPTUNE_PORT: '8182',
              UPDATE_DEADLINE_MS: '3000',
              DRIVER_COUNT: '156000',
            },
          },
          filename: '../../../lib/placeholder.zip',
          vpcConfig: {
            subnetIds: props.privateSubnets.get(region)!.map(s => s.id),
            securityGroupIds: [props.lambdaSecurityGroups.get(region)!.id],
          },
          tracingConfig: {
            mode: 'Active',
          },
          deadLetterConfig: {
            targetArn: graphUpdaterDLQ.arn,
          },
          dependsOn: [graphUpdaterLogGroup],
        }
      );

      this.graphUpdaterFunctions.set(region, graphUpdaterFunction.functionName);

      // Kinesis trigger for graph updater
      new LambdaEventSourceMapping(this, `kinesis-trigger-${region}`, {
        provider,
        functionName: graphUpdaterFunction.arn,
        eventSourceArn: kinesisStream.arn,
        startingPosition: 'LATEST',
        maximumBatchingWindowInSeconds: 1,
        parallelizationFactor: 10,
        maximumRecordAgeInSeconds: 60,
      });
    });
  }
}
