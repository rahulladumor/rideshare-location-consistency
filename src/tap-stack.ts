import { Construct } from 'constructs';
import { TerraformStack, TerraformOutput } from 'cdktf';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { LocationIngestion } from './constructs/location-ingestion';
import { StorageLayer } from './constructs/storage-layer';
import { StreamProcessing } from './constructs/stream-processing';
import { GraphLayer } from './constructs/graph-layer';
import { ConsistencyChecker } from './constructs/consistency-checker';
import { CorrectionSystem } from './constructs/correction-system';
import { Monitoring } from './constructs/monitoring';

export interface TapStackConfig {
  environment: string;
  regions: string[];
  primaryRegion: string;
  driverCount: number;
  costCenter?: string;
  owner?: string;
}

export class TapStack extends TerraformStack {
  public readonly outputs: { [key: string]: TerraformOutput } = {};

  constructor(scope: Construct, id: string, config?: TapStackConfig) {
    super(scope, id);

    // Use default config if not provided
    const stackConfig: TapStackConfig = config || {
      environment: process.env.ENVIRONMENT || 'dev',
      regions: ['us-east-1', 'us-west-2'],
      primaryRegion: 'us-east-1',
      driverCount: 156000,
    };

    // Configure providers for all regions
    const providers: Map<string, AwsProvider> = new Map();
    stackConfig.regions.forEach(region => {
      providers.set(
        region,
        new AwsProvider(this, `aws-${region}`, {
          region: region,
          alias: region,
          defaultTags: [
            {
              tags: {
                Environment: stackConfig.environment,
                Project: 'location-consistency',
                ManagedBy: 'cdktf',
                Region: region,
                CostCenter: stackConfig.costCenter || 'location-services',
                Owner: stackConfig.owner || 'platform-team',
              },
            },
          ],
        })
      );
    });

    // Primary provider for global resources
    const primaryProvider = providers.get(stackConfig.primaryRegion)!;

    // 1. Storage Layer - DynamoDB Global Tables and ElastiCache
    const storageLayer = new StorageLayer(this, 'storage-layer', {
      providers,
      regions: stackConfig.regions,
      primaryRegion: stackConfig.primaryRegion,
      tableName: 'driver-locations',
      environment: stackConfig.environment,
    });

    // 2. Location Ingestion - IoT Core and Lambda
    const locationIngestion = new LocationIngestion(
      this,
      'location-ingestion',
      {
        provider: primaryProvider,
        driverCount: stackConfig.driverCount,
        dynamoTableName: storageLayer.tableName,
        dynamoTableArn: storageLayer.tableArn,
        environment: stackConfig.environment,
        maxThroughput: 5200,
      }
    );

    // 3. Graph Layer - Neptune for proximity mapping
    const graphLayer = new GraphLayer(this, 'graph-layer', {
      providers,
      regions: stackConfig.regions,
      environment: stackConfig.environment,
      driverCount: stackConfig.driverCount,
    });

    // 4. Stream Processing - Kinesis and Lambda processors
    const streamProcessing = new StreamProcessing(this, 'stream-processing', {
      providers,
      regions: stackConfig.regions,
      dynamoStreamArns: storageLayer.streamArns,
      elastiCacheClusters: storageLayer.elastiCacheClusters,
      neptuneEndpoints: graphLayer.neptuneEndpoints,
      privateSubnets: storageLayer.privateSubnets,
      lambdaSecurityGroups: storageLayer.lambdaSecurityGroups,
      environment: stackConfig.environment,
    });

    // 5. Correction System - S3 snapshots
    const correctionSystem = new CorrectionSystem(this, 'correction-system', {
      provider: primaryProvider,
      regions: stackConfig.regions,
      environment: stackConfig.environment,
      dynamoTableName: storageLayer.tableName,
    });

    // 6. Consistency Checker - EventBridge and Step Functions
    const consistencyChecker = new ConsistencyChecker(
      this,
      'consistency-checker',
      {
        providers,
        regions: stackConfig.regions,
        primaryRegion: stackConfig.primaryRegion,
        elastiCacheClusters: storageLayer.elastiCacheClusters,
        snapshotBucketArn: correctionSystem.snapshotBucketArn,
        kinesisStreamArns: streamProcessing.kinesisStreamArns,
        environment: stackConfig.environment,
      }
    );

    // 7. Monitoring - CloudWatch Alarms and Dashboards
    const lambdaFunctionNames = new Map<string, string[]>();
    stackConfig.regions.forEach(region => {
      lambdaFunctionNames.set(region, [
        streamProcessing.cacheUpdaterFunctions.get(region)!,
        streamProcessing.graphUpdaterFunctions.get(region)!,
      ]);
    });

    new Monitoring(this, 'monitoring', {
      providers,
      regions: stackConfig.regions,
      environment: stackConfig.environment,
      kinesisStreamNames: streamProcessing.kinesisStreamNames,
      lambdaFunctionNames,
      dynamoTableName: storageLayer.tableName,
    });

    // Outputs
    this.outputs['iot-endpoint'] = new TerraformOutput(this, 'iot-endpoint', {
      value: locationIngestion.iotEndpoint,
      description: 'IoT Core endpoint for driver location updates',
    });

    this.outputs['dynamodb-table-name'] = new TerraformOutput(
      this,
      'dynamodb-table-name',
      {
        value: storageLayer.tableName,
        description: 'DynamoDB global table name',
      }
    );

    this.outputs['step-functions-arn'] = new TerraformOutput(
      this,
      'step-functions-arn',
      {
        value: consistencyChecker.stateMachineArn,
        description: 'Step Functions state machine ARN for consistency checks',
      }
    );
  }
}
