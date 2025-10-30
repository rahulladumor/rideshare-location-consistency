# Getting Started Guide

This guide will walk you through setting up and deploying the real-time location consistency system.

## Prerequisites

### Required Software

1. **Node.js** (>= 18.0.0)
   ```bash
   node --version
   # v18.0.0 or higher
   ```

2. **npm** (>= 9.0.0)
   ```bash
   npm --version
   # 9.0.0 or higher
   ```

3. **Terraform** (>= 1.5.0)
   ```bash
   terraform --version
   # Terraform v1.5.0 or higher
   ```

4. **CDKTF** (>= 0.20.0)
   ```bash
   cdktf --version
   # 0.20.0 or higher
   ```

5. **AWS CLI** (>= 2.0)
   ```bash
   aws --version
   # aws-cli/2.0.0 or higher
   ```

### AWS Account Requirements

- AWS Account with administrative access
- At least 2 regions enabled (recommend us-east-1 and us-west-2)
- Service quotas sufficient for the deployment:
  - Lambda: 50+ concurrent executions
  - DynamoDB: On-demand capacity
  - ElastiCache: 2+ cache nodes per region
  - Neptune: 1+ instance per region
  - IoT Core: 5,000+ connections

### Cost Considerations

**Development Environment** (2 regions):
- **$800-1,000/month** for testing with 1,000 simulated drivers

**Production Environment** (45 regions):
- **$35,000-40,000/month** for 156,000 drivers

See [Cost Analysis](./COST_ANALYSIS.md) for detailed breakdown.

## Quick Start (Development)

### 1. Clone the Repository

```bash
git clone https://github.com/rahulladumor/rideshare-location-consistency.git
cd rideshare-location-consistency
```

### 2. Install Dependencies

```bash
npm install
```

This installs:
- CDKTF and providers
- TypeScript and build tools
- Testing frameworks
- AWS SDK

### 3. Configure AWS Credentials

```bash
aws configure
# AWS Access Key ID: YOUR_ACCESS_KEY
# AWS Secret Access Key: YOUR_SECRET_KEY
# Default region: us-east-1
# Default output format: json
```

Verify credentials:
```bash
aws sts get-caller-identity
```

### 4. Initialize CDKTF

```bash
cdktf get
```

This downloads and generates TypeScript bindings for AWS provider.

### 5. Configure Your Deployment

Create a configuration file `config/dev.json`:

```json
{
  "environment": "dev",
  "regions": ["us-east-1", "us-west-2"],
  "primaryRegion": "us-east-1",
  "driverCount": 1000,
  "costCenter": "engineering",
  "owner": "your-team"
}
```

### 6. Synthesize Infrastructure

```bash
cdktf synth
```

This generates Terraform configuration files in `cdktf.out/`.

Review the generated plan:
```bash
cd cdktf.out/stacks/dev
terraform plan
```

### 7. Deploy Infrastructure

**Option A: Deploy everything (recommended for first time)**
```bash
cdktf deploy
```

**Option B: Deploy specific components**
```bash
cdktf deploy storage-layer
cdktf deploy location-ingestion
cdktf deploy consistency-checker
```

Deployment takes approximately **20-30 minutes** for 2 regions.

### 8. Verify Deployment

```bash
# Check IoT endpoint
aws iot describe-endpoint --endpoint-type iot:Data-ATS

# Check DynamoDB table
aws dynamodb describe-table --table-name driver-locations-us-east-1-dev

# Check Lambda functions
aws lambda list-functions --query 'Functions[?contains(FunctionName, `location-processor`)].FunctionName'

# Check ElastiCache clusters
aws elasticache describe-replication-groups --query 'ReplicationGroups[*].ReplicationGroupId'
```

### 9. Test the System

Run the simulation script:
```bash
npm run simulate -- --drivers 100 --duration 300
```

This simulates 100 drivers sending location updates for 5 minutes.

Monitor in CloudWatch:
```bash
aws cloudwatch get-dashboard --dashboard-name location-consistency-dev
```

## Step-by-Step Tutorial

### Tutorial 1: Deploy Storage Layer Only

Let's start by deploying just the storage layer to understand the basics.

#### Step 1: Create a Minimal Configuration

Create `src/simple-storage.ts`:

```typescript
import { App } from 'cdktf';
import { Construct } from 'constructs';
import { TerraformStack } from 'cdktf';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { StorageLayer } from './constructs/storage-layer';

class SimpleStorageStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const regions = ['us-east-1', 'us-west-2'];
    const providers = new Map<string, AwsProvider>();

    regions.forEach(region => {
      providers.set(region, new AwsProvider(this, `aws-${region}`, {
        region: region,
        alias: region
      }));
    });

    new StorageLayer(this, 'storage', {
      providers,
      regions,
      primaryRegion: 'us-east-1',
      tableName: 'driver-locations',
      environment: 'dev'
    });
  }
}

const app = new App();
new SimpleStorageStack(app, 'simple-storage');
app.synth();
```

#### Step 2: Deploy

```bash
cdktf deploy simple-storage
```

#### Step 3: Verify DynamoDB Table

```bash
# Describe the table
aws dynamodb describe-table \
  --table-name driver-locations-us-east-1-dev \
  --region us-east-1

# Test write
aws dynamodb put-item \
  --table-name driver-locations-us-east-1-dev \
  --item '{
    "driverId": {"S": "driver-test-001"},
    "timestamp": {"N": "1698765432000"},
    "latitude": {"N": "37.7749"},
    "longitude": {"N": "-122.4194"},
    "city": {"S": "san-francisco"}
  }' \
  --region us-east-1

# Verify replication to us-west-2
aws dynamodb get-item \
  --table-name driver-locations-us-west-2-dev \
  --key '{"driverId": {"S": "driver-test-001"}}' \
  --region us-west-2
```

#### Step 4: Test ElastiCache

```bash
# Get cluster endpoint
REDIS_ENDPOINT=$(aws elasticache describe-replication-groups \
  --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' \
  --output text \
  --region us-east-1)

# Connect using redis-cli (requires VPN or EC2 instance)
redis-cli -h $REDIS_ENDPOINT -p 6379 --tls

# Test geospatial commands
GEOADD location-index -122.4194 37.7749 driver-test-001
GEORADIUS location-index -122.4194 37.7749 5 km
```

### Tutorial 2: Add Location Ingestion

Now let's add IoT Core and Lambda to process location updates.

#### Step 1: Create Lambda Function Code

Create `lambda/location-processor/index.js`:

```javascript
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const dynamodb = new DynamoDBClient({});

exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  const { driverId, latitude, longitude, city, timestamp } = event;
  
  // Validate input
  if (!driverId || !latitude || !longitude || !city) {
    throw new Error('Missing required fields');
  }
  
  // Conditional write - only update if timestamp is newer
  const params = {
    TableName: process.env.DYNAMO_TABLE_NAME,
    Item: {
      driverId: { S: driverId },
      timestamp: { N: timestamp.toString() },
      latitude: { N: latitude.toString() },
      longitude: { N: longitude.toString() },
      city: { S: city },
      updatedAt: { N: Date.now().toString() }
    },
    ConditionExpression: 'attribute_not_exists(driverId) OR #ts < :newTimestamp',
    ExpressionAttributeNames: {
      '#ts': 'timestamp'
    },
    ExpressionAttributeValues: {
      ':newTimestamp': { N: timestamp.toString() }
    }
  };
  
  const startTime = Date.now();
  
  try {
    await dynamodb.send(new PutItemCommand(params));
    const duration = Date.now() - startTime;
    
    console.log(`Write completed in ${duration}ms`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Location updated', duration })
    };
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.log('Stale update ignored');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Stale update ignored' })
      };
    }
    throw error;
  }
};
```

#### Step 2: Package Lambda Function

```bash
cd lambda/location-processor
zip -r ../location-processor.zip .
cd ../..
```

#### Step 3: Update Stack to Include Ingestion

Update your stack to add the LocationIngestion construct.

#### Step 4: Deploy

```bash
cdktf deploy
```

#### Step 5: Test IoT Core

```bash
# Get IoT endpoint
IOT_ENDPOINT=$(aws iot describe-endpoint \
  --endpoint-type iot:Data-ATS \
  --query 'endpointAddress' \
  --output text)

# Publish test message
aws iot-data publish \
  --topic "driver/driver-test-001/location" \
  --payload '{
    "driverId": "driver-test-001",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "city": "san-francisco",
    "timestamp": 1698765432000
  }' \
  --cli-binary-format raw-in-base64-out

# Check CloudWatch Logs
aws logs tail /aws/lambda/location-processor-dev --follow
```

### Tutorial 3: Full System Deployment

Deploy all components:

```bash
cdktf deploy --auto-approve
```

Monitor the deployment:
```bash
watch -n 5 'aws cloudformation describe-stacks --query "Stacks[*].[StackName,StackStatus]" --output table'
```

## Configuration Options

### Environment Variables

Set these before deployment:

```bash
export ENVIRONMENT=dev                    # dev, staging, prod
export AWS_REGION=us-east-1              # primary region
export DRIVER_COUNT=1000                 # for capacity planning
export COST_CENTER=engineering           # for cost tracking
export OWNER_TEAM=platform               # for ownership
```

### Infrastructure Configuration

Edit `src/main.ts`:

```typescript
const config: TapStackConfig = {
  environment: process.env.ENVIRONMENT || 'dev',
  regions: ['us-east-1', 'us-west-2', 'eu-west-1'],  // Add more regions
  primaryRegion: 'us-east-1',
  driverCount: parseInt(process.env.DRIVER_COUNT || '1000'),
  costCenter: process.env.COST_CENTER,
  owner: process.env.OWNER_TEAM
};
```

### Scaling Configuration

Adjust for your workload:

```typescript
// Low-cost development
const devConfig = {
  driverCount: 100,
  lambdaMemory: 512,
  cacheNodeType: 'cache.t3.small',
  neptuneInstanceType: 'db.t3.medium'
};

// Production
const prodConfig = {
  driverCount: 156000,
  lambdaMemory: 3008,
  cacheNodeType: 'cache.r6g.large',
  neptuneInstanceType: 'db.r5.large'
};
```

## Monitoring Your Deployment

### CloudWatch Dashboard

Access the auto-created dashboard:
```bash
aws cloudwatch get-dashboard \
  --dashboard-name location-consistency-dev
```

### Key Metrics to Watch

1. **Ingestion Metrics**:
   - IoT messages received/sec
   - Lambda invocations/sec
   - Lambda errors
   - Lambda duration (target: < 50ms)

2. **Storage Metrics**:
   - DynamoDB write capacity
   - DynamoDB throttles (should be 0)
   - DynamoDB replication lag
   - Stream records processed

3. **Cache Metrics**:
   - ElastiCache CPU usage
   - Cache hit rate
   - Network bytes in/out
   - Commands processed/sec

4. **Consistency Metrics**:
   - Drift detection runs
   - Average drift distance
   - Correction triggers
   - Correction success rate

### Alarms

Critical alarms are automatically configured:

- Lambda errors > 10/min
- DynamoDB throttles > 0
- ElastiCache CPU > 75%
- Step Functions failures > 5%
- Drift correction failures > 1

## Troubleshooting

### Common Issues

#### Issue: CDKTF synth fails

**Error**:
```
Error: Cannot find module '@cdktf/provider-aws'
```

**Solution**:
```bash
npm install
cdktf get
```

#### Issue: Terraform plan shows quota errors

**Error**:
```
Error: Error creating Lambda function: LimitExceededException: 
Concurrent executions quota exceeded
```

**Solution**:
Request quota increase in AWS Service Quotas console or reduce `reservedConcurrentExecutions`.

#### Issue: ElastiCache connection timeout

**Error**:
```
Error: Connection timeout connecting to ElastiCache
```

**Solution**:
ElastiCache is in a VPC. You need either:
1. Lambda in the same VPC (already configured)
2. VPN connection to VPC
3. EC2 bastion host in the VPC

#### Issue: DynamoDB replication lag high

**Symptom**: Replication takes > 5 seconds

**Solution**:
1. Check if any region has degraded performance
2. Verify network connectivity between regions
3. Reduce write throughput temporarily
4. Check DynamoDB service health

### Getting Help

- **GitHub Issues**: Report bugs and request features
- **Discussions**: Ask questions and share ideas
- **Documentation**: Check the [Architecture](./ARCHITECTURE.md) and [Components](./COMPONENTS.md) guides
- **AWS Support**: For AWS-specific issues

## Next Steps

1. **Learn the Architecture**: Read [ARCHITECTURE.md](./ARCHITECTURE.md)
2. **Understand Components**: Review [COMPONENTS.md](./COMPONENTS.md)
3. **Optimize Performance**: Check [PERFORMANCE.md](./PERFORMANCE.md)
4. **Deploy to Production**: Follow [DEPLOYMENT.md](./DEPLOYMENT.md)
5. **Monitor and Maintain**: See [MONITORING.md](./MONITORING.md)

## Clean Up

When you're done testing:

```bash
# Destroy all resources
cdktf destroy

# Confirm destruction
# Type 'yes' when prompted
```

**Warning**: This will delete all data. Make sure to backup anything important first.

### Manual Cleanup (if needed)

```bash
# Delete DynamoDB tables
aws dynamodb delete-table --table-name driver-locations-us-east-1-dev
aws dynamodb delete-table --table-name driver-locations-us-west-2-dev

# Delete ElastiCache clusters
aws elasticache delete-replication-group --replication-group-id location-cache-dev

# Delete Neptune clusters
aws neptune delete-db-cluster --db-cluster-identifier location-graph-dev

# Delete S3 buckets
aws s3 rb s3://location-snapshots-dev --force

# Delete Lambda functions
aws lambda delete-function --function-name location-processor-dev
```

---

Congratulations! You now have a working real-time location consistency system. 🎉
