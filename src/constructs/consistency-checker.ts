import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule';
import { CloudwatchEventTarget } from '@cdktf/provider-aws/lib/cloudwatch-event-target';
import { ElasticacheReplicationGroup } from '@cdktf/provider-aws/lib/elasticache-replication-group';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import { Construct } from 'constructs';

export interface ConsistencyCheckerProps {
  providers: Map<string, AwsProvider>;
  regions: string[];
  primaryRegion: string;
  elastiCacheClusters: Map<string, ElasticacheReplicationGroup>;
  snapshotBucketArn: string;
  kinesisStreamArns: Map<string, string>;
  environment: string;
}

export class ConsistencyChecker extends Construct {
  public readonly stateMachineArn: string;

  constructor(scope: Construct, id: string, props: ConsistencyCheckerProps) {
    super(scope, id);

    const primaryProvider = props.providers.get(props.primaryRegion)!;

    // Lambda role for drift detector
    const driftDetectorRole = new IamRole(this, 'drift-detector-role', {
      provider: primaryProvider,
      namePrefix: `drift-detector-role-${props.environment}-`,
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

    // Drift detector Lambda policy
    new IamRolePolicy(this, 'drift-detector-policy', {
      provider: primaryProvider,
      role: driftDetectorRole.id,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
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
            Action: ['s3:GetObject', 's3:ListBucket'],
            Resource: [props.snapshotBucketArn, `${props.snapshotBucketArn}/*`],
          },
          {
            Effect: 'Allow',
            Action: ['kinesis:PutRecord', 'kinesis:PutRecords'],
            Resource: Array.from(props.kinesisStreamArns.values()),
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

    // Drift detector Lambda
    const driftDetectorFunction = new LambdaFunction(this, 'drift-detector', {
      provider: primaryProvider,
      functionName: `drift-detector-${props.environment}`,
      role: driftDetectorRole.arn,
      handler: 'index.handler',
      runtime: 'nodejs20.x',
      timeout: 60,
      memorySize: 3008,
      environment: {
        variables: {
          REGIONS: JSON.stringify(props.regions),
          ELASTICACHE_ENDPOINT: props.elastiCacheClusters.get(props.regions[0])!
            .configurationEndpointAddress,
          SNAPSHOT_BUCKET: props.snapshotBucketArn.split(':').pop()!,
          DETECTION_DEADLINE_MS: '3000',
          CORRECTION_DEADLINE_MS: '8000',
        },
      },
      filename: '../../../lib/placeholder.zip',
      dependsOn: Array.from(props.elastiCacheClusters.values()),
    });

    // State corrector Lambda
    const stateCorrectorFunction = new LambdaFunction(this, 'state-corrector', {
      provider: primaryProvider,
      functionName: `state-corrector-${props.environment}`,
      role: driftDetectorRole.arn,
      handler: 'index.handler',
      runtime: 'nodejs20.x',
      timeout: 60,
      memorySize: 3008,
      environment: {
        variables: {
          KINESIS_STREAMS: JSON.stringify(
            Object.fromEntries(props.kinesisStreamArns.entries())
          ),
          SNAPSHOT_BUCKET: props.snapshotBucketArn.split(':').pop()!,
          PROPAGATION_DEADLINE_MS: '8000',
        },
      },
      filename: '../../../lib/placeholder.zip',
    });

    // Step Functions role
    const stepFunctionsRole = new IamRole(this, 'step-functions-role', {
      provider: primaryProvider,
      namePrefix: `consistency-checker-sf-role-${props.environment}-`,
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Principal: { Service: 'states.amazonaws.com' },
            Effect: 'Allow',
          },
        ],
      }),
    });

    // Step Functions policy
    new IamRolePolicy(this, 'step-functions-policy', {
      provider: primaryProvider,
      role: stepFunctionsRole.id,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['lambda:InvokeFunction'],
            Resource: [driftDetectorFunction.arn, stateCorrectorFunction.arn],
          },
        ],
      }),
    });

    // Step Functions state machine definition
    const stateMachineDefinition = {
      Comment: 'Location consistency checker workflow',
      StartAt: 'CompareRegions',
      States: {
        CompareRegions: {
          Type: 'Parallel',
          Branches: props.regions.map(region => ({
            StartAt: `CheckRegion${region.replace(/-/g, '')}`,
            States: {
              [`CheckRegion${region.replace(/-/g, '')}`]: {
                Type: 'Task',
                Resource: 'arn:aws:states:::lambda:invoke',
                Parameters: {
                  FunctionName: driftDetectorFunction.arn,
                  Payload: {
                    region: region,
                    action: 'compare',
                  },
                },
                TimeoutSeconds: 5,
                End: true,
              },
            },
          })),
          Next: 'AnalyzeDrift',
        },
        AnalyzeDrift: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: driftDetectorFunction.arn,
            Payload: {
              action: 'analyze',
              'results.$': '$',
            },
          },
          Next: 'DriftDetected?',
        },
        'DriftDetected?': {
          Type: 'Choice',
          Choices: [
            {
              Variable: '$.Payload.driftDetected',
              BooleanEquals: true,
              Next: 'CorrectDrift',
            },
          ],
          Default: 'Success',
        },
        CorrectDrift: {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: stateCorrectorFunction.arn,
            Payload: {
              'driftRegions.$': '$.Payload.driftRegions',
              'canonicalState.$': '$.Payload.canonicalState',
            },
          },
          TimeoutSeconds: 10,
          End: true,
        },
        Success: {
          Type: 'Succeed',
        },
      },
    };

    // Create Step Functions state machine
    const stateMachine = new SfnStateMachine(
      this,
      'consistency-state-machine',
      {
        provider: primaryProvider,
        name: `location-consistency-checker-${props.environment}`,
        roleArn: stepFunctionsRole.arn,
        definition: JSON.stringify(stateMachineDefinition),
      }
    );

    // EventBridge rule to trigger every 1 minute (minimum for rate expressions)
    const eventRule = new CloudwatchEventRule(this, 'consistency-check-rule', {
      provider: primaryProvider,
      name: `location-consistency-check-${props.environment}`,
      scheduleExpression: 'rate(1 minute)',
      state: 'ENABLED',
    });

    // EventBridge target
    new CloudwatchEventTarget(this, 'consistency-check-target', {
      provider: primaryProvider,
      rule: eventRule.name,
      arn: stateMachine.arn,
      roleArn: stepFunctionsRole.arn,
    });

    this.stateMachineArn = stateMachine.arn;
  }
}
