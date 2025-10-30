import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule';
import { CloudwatchEventTarget } from '@cdktf/provider-aws/lib/cloudwatch-event-target';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { S3BucketLifecycleConfiguration } from '@cdktf/provider-aws/lib/s3-bucket-lifecycle-configuration';
import { S3BucketPublicAccessBlock } from '@cdktf/provider-aws/lib/s3-bucket-public-access-block';
import { S3BucketServerSideEncryptionConfigurationA } from '@cdktf/provider-aws/lib/s3-bucket-server-side-encryption-configuration';
import { S3BucketVersioningA } from '@cdktf/provider-aws/lib/s3-bucket-versioning';
import { Construct } from 'constructs';
import * as crypto from 'crypto';

export interface CorrectionSystemProps {
  provider: AwsProvider;
  regions: string[];
  environment: string;
  dynamoTableName: string;
}

export class CorrectionSystem extends Construct {
  public readonly snapshotBucketArn: string;

  constructor(scope: Construct, id: string, props: CorrectionSystemProps) {
    super(scope, id);

    // S3 bucket for canonical state snapshots
    const snapshotBucket = new S3Bucket(this, 'snapshot-bucket', {
      provider: props.provider,
      bucket: `location-snapshots-${props.environment}-${crypto.randomBytes(4).toString('hex')}`,
      forceDestroy: props.environment !== 'production',
      tags: {
        Environment: props.environment,
        Purpose: 'canonical-state-snapshots',
      },
    });

    // Enable server-side encryption
    new S3BucketServerSideEncryptionConfigurationA(
      this,
      'snapshot-encryption',
      {
        provider: props.provider,
        bucket: snapshotBucket.id,
        rule: [
          {
            applyServerSideEncryptionByDefault: {
              sseAlgorithm: 'AES256',
            },
            bucketKeyEnabled: true,
          },
        ],
      }
    );

    // Block public access
    new S3BucketPublicAccessBlock(this, 'snapshot-public-access-block', {
      provider: props.provider,
      bucket: snapshotBucket.id,
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    });

    // Enable versioning
    new S3BucketVersioningA(this, 'snapshot-versioning', {
      provider: props.provider,
      bucket: snapshotBucket.id,
      versioningConfiguration: {
        status: 'Enabled',
      },
    });

    // Lifecycle policy to manage old snapshots
    new S3BucketLifecycleConfiguration(this, 'snapshot-lifecycle', {
      provider: props.provider,
      bucket: snapshotBucket.id,
      rule: [
        {
          id: 'cleanup-old-snapshots',
          status: 'Enabled',
          filter: [
            {
              prefix: '',
            },
          ],
          expiration: [
            {
              days: 90,
            },
          ],
          noncurrentVersionExpiration: [
            {
              noncurrentDays: 7,
            },
          ],
          abortIncompleteMultipartUpload: [
            {
              daysAfterInitiation: 1,
            },
          ],
        },
      ],
    });

    // Lambda role for snapshot creator
    const snapshotRole = new IamRole(this, 'snapshot-role', {
      provider: props.provider,
      namePrefix: `snapshot-creator-role-${props.environment}-`,
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

    // Snapshot creator policy
    new IamRolePolicy(this, 'snapshot-policy', {
      provider: props.provider,
      role: snapshotRole.id,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'dynamodb:Scan',
              'dynamodb:Query',
              'dynamodb:BatchGetItem',
            ],
            Resource: `arn:aws:dynamodb:*:*:table/${props.dynamoTableName}`,
          },
          {
            Effect: 'Allow',
            Action: ['s3:PutObject', 's3:PutObjectAcl', 's3:GetObject'],
            Resource: `${snapshotBucket.arn}/*`,
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

    // Snapshot creator Lambda
    const snapshotFunction = new LambdaFunction(this, 'snapshot-creator', {
      provider: props.provider,
      functionName: `location-snapshot-creator-${props.environment}`,
      role: snapshotRole.arn,
      handler: 'index.handler',
      runtime: 'nodejs20.x',
      timeout: 300,
      memorySize: 3008,
      environment: {
        variables: {
          DYNAMO_TABLE_NAME: props.dynamoTableName,
          SNAPSHOT_BUCKET: snapshotBucket.id,
          REGIONS: JSON.stringify(props.regions),
        },
      },
      filename: '../../../lib/placeholder.zip',
    });

    // EventBridge rule to create snapshots every hour
    const snapshotRule = new CloudwatchEventRule(this, 'snapshot-rule', {
      provider: props.provider,
      name: `location-snapshot-schedule-${props.environment}`,
      scheduleExpression: 'rate(1 hour)',
      state: 'ENABLED',
    });

    // EventBridge target
    new CloudwatchEventTarget(this, 'snapshot-target', {
      provider: props.provider,
      rule: snapshotRule.name,
      arn: snapshotFunction.arn,
    });

    this.snapshotBucketArn = snapshotBucket.arn;
  }
}
