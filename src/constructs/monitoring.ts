import { Construct } from 'constructs';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { CloudwatchMetricAlarm } from '@cdktf/provider-aws/lib/cloudwatch-metric-alarm';
import { CloudwatchDashboard } from '@cdktf/provider-aws/lib/cloudwatch-dashboard';

export interface MonitoringProps {
  providers: Map<string, AwsProvider>;
  regions: string[];
  environment: string;
  kinesisStreamNames: Map<string, string>;
  lambdaFunctionNames: Map<string, string[]>;
  dynamoTableName: string;
}

export class Monitoring extends Construct {
  public readonly dashboardArn: string;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);

    // Create alarms for each region
    props.providers.forEach((provider, region) => {
      // Kinesis stream alarm
      new CloudwatchMetricAlarm(this, `kinesis-alarm-${region}`, {
        provider,
        alarmName: `${props.environment}-kinesis-records-${region}`,
        comparisonOperator: 'LessThanThreshold',
        evaluationPeriods: 2,
        metricName: 'IncomingRecords',
        namespace: 'AWS/Kinesis',
        period: 300,
        statistic: 'Sum',
        threshold: 1,
        dimensions: {
          StreamName: props.kinesisStreamNames.get(region)!,
        },
        tags: {
          Environment: props.environment,
          Region: region,
        },
      });

      // DynamoDB table alarm
      new CloudwatchMetricAlarm(this, `dynamodb-alarm-${region}`, {
        provider,
        alarmName: `${props.environment}-dynamodb-throttles-${region}`,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        metricName: 'UserErrors',
        namespace: 'AWS/DynamoDB',
        period: 60,
        statistic: 'Sum',
        threshold: 10,
        dimensions: {
          TableName: `${props.dynamoTableName}-${region}-${props.environment}`,
        },
        tags: {
          Environment: props.environment,
          Region: region,
        },
      });

      // Lambda function alarms
      const lambdaFunctions = props.lambdaFunctionNames.get(region)!;
      lambdaFunctions.forEach((functionName, idx) => {
        new CloudwatchMetricAlarm(this, `lambda-errors-${region}-${idx}`, {
          provider,
          alarmName: `${props.environment}-lambda-errors-${functionName}`,
          comparisonOperator: 'GreaterThanThreshold',
          evaluationPeriods: 1,
          metricName: 'Errors',
          namespace: 'AWS/Lambda',
          period: 60,
          statistic: 'Sum',
          threshold: 5,
          dimensions: {
            FunctionName: functionName,
          },
          tags: {
            Environment: props.environment,
            Region: region,
          },
        });
      });
    });

    // Create CloudWatch Dashboard in primary region
    const primaryProvider = props.providers.get(props.regions[0])!;
    const dashboard = new CloudwatchDashboard(this, 'dashboard', {
      provider: primaryProvider,
      dashboardName: `${props.environment}-location-system`,
      dashboardBody: JSON.stringify({
        widgets: [
          {
            type: 'metric',
            properties: {
              metrics: [
                ['AWS/Kinesis', 'IncomingRecords', { stat: 'Sum' }],
                ['AWS/DynamoDB', 'ConsumedReadCapacityUnits', { stat: 'Sum' }],
                ['AWS/Lambda', 'Invocations', { stat: 'Sum' }],
              ],
              period: 300,
              stat: 'Sum',
              region: props.regions[0],
              title: 'System Overview',
            },
          },
        ],
      }),
    });

    this.dashboardArn = dashboard.dashboardArn;
  }
}
