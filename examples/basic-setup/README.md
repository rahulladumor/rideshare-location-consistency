# Basic Setup Example

This example shows the simplest possible deployment of the location consistency system with just 2 regions.

## What's Included

- **2 Regions**: us-east-1 (primary) and us-west-2
- **1,000 Simulated Drivers**: For testing
- **All Core Components**: Ingestion, storage, streaming, consistency checking
- **Estimated Cost**: ~$800/month

## Quick Deploy

```bash
# 1. Install dependencies
npm install
cdktf get

# 2. Configure AWS
aws configure

# 3. Deploy
cdktf deploy

# 4. Test
npm run simulate -- --drivers 100 --duration 60
```

## Configuration

The example uses minimal configuration in `src/basic-example.ts`:

```typescript
import { App } from 'cdktf';
import { TapStack } from '../tap-stack';

const app = new App();

new TapStack(app, 'basic-location-system', {
  environment: 'dev',
  regions: ['us-east-1', 'us-west-2'],
  primaryRegion: 'us-east-1',
  driverCount: 1000,
  costCenter: 'learning',
  owner: 'student'
});

app.synth();
```

## Architecture

```
                    Driver Apps (1,000)
                           ↓
                  AWS IoT Core (us-east-1)
                           ↓
                    Lambda Processor
                           ↓
            ┌──────────────┴──────────────┐
            ↓                             ↓
    DynamoDB (us-east-1)          DynamoDB (us-west-2)
            ↓                             ↓
    ElastiCache (us-east-1)       ElastiCache (us-west-2)
            ↓                             ↓
    Neptune (us-east-1)           Neptune (us-west-2)
                           ↓
                    Step Functions
                   (Consistency Check)
```

## What Gets Created

### us-east-1 (Primary Region)

- IoT Core endpoint and rules
- Lambda functions (4 total):
  - location-processor
  - cache-updater
  - graph-updater
  - drift-detector
- DynamoDB global table
- ElastiCache Redis cluster (2 nodes)
- Neptune graph database
- Kinesis stream (1 shard)
- Step Functions state machine
- S3 bucket for snapshots
- CloudWatch dashboard
- VPC with private subnets

### us-west-2 (Replica Region)

- DynamoDB replica
- ElastiCache Redis cluster (2 nodes)
- Neptune graph database
- Kinesis stream (1 shard)
- Lambda functions (2 total):
  - cache-updater
  - graph-updater
- VPC with private subnets

## Testing the System

### 1. Publish Location Update

```bash
# Get IoT endpoint
IOT_ENDPOINT=$(aws iot describe-endpoint \
  --endpoint-type iot:Data-ATS \
  --query 'endpointAddress' \
  --output text \
  --region us-east-1)

# Publish test message
aws iot-data publish \
  --topic "driver/test-driver-001/location" \
  --payload '{
    "driverId": "test-driver-001",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "city": "san-francisco",
    "timestamp": 1698765432000,
    "accuracy": 10,
    "speed": 45,
    "heading": 270
  }' \
  --cli-binary-format raw-in-base64-out \
  --region us-east-1
```

### 2. Verify DynamoDB Write

```bash
# Check us-east-1
aws dynamodb get-item \
  --table-name driver-locations-us-east-1-dev \
  --key '{"driverId": {"S": "test-driver-001"}}' \
  --region us-east-1

# Check replication to us-west-2 (wait ~1 second)
sleep 1
aws dynamodb get-item \
  --table-name driver-locations-us-west-2-dev \
  --key '{"driverId": {"S": "test-driver-001"}}' \
  --region us-west-2
```

### 3. Run Load Test

```bash
# Simulate 100 drivers for 5 minutes
npm run simulate -- \
  --drivers 100 \
  --duration 300 \
  --update-interval 3

# Monitor in CloudWatch
aws cloudwatch get-dashboard \
  --dashboard-name location-consistency-dev \
  --region us-east-1
```

### 4. Watch Lambda Logs

```bash
# Location processor
aws logs tail /aws/lambda/location-processor-dev \
  --follow \
  --region us-east-1

# Cache updater
aws logs tail /aws/lambda/cache-updater-us-east-1-dev \
  --follow \
  --region us-east-1
```

### 5. Check Consistency

```bash
# Step Functions will run every 10 seconds
# View execution history
aws stepfunctions list-executions \
  --state-machine-arn $(aws stepfunctions list-state-machines \
    --query 'stateMachines[?name==`consistency-checker-dev`].stateMachineArn' \
    --output text \
    --region us-east-1) \
  --region us-east-1
```

## Monitoring

### CloudWatch Dashboard

Access at: https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=location-consistency-dev

**Metrics to watch**:
- IoT messages received/sec
- Lambda invocations and errors
- DynamoDB write capacity and throttles
- ElastiCache CPU and memory
- Drift detection results

### Key Alarms

Automatically configured:
- Lambda errors > 10/min
- DynamoDB throttles > 0
- ElastiCache CPU > 75%
- Step Functions failures > 5%

## Performance Benchmarks

Expected performance for this setup:

| Metric | Target | Typical |
|--------|--------|---------|
| IoT → Lambda | < 50ms | 35ms |
| Lambda → DynamoDB | < 50ms | 25ms |
| DynamoDB replication | < 1s | 800ms |
| ElastiCache update | < 2s | 1.5s |
| Neptune graph update | < 3s | 2.2s |
| End-to-end latency | < 3s | 2.4s |

## Scaling Up

To handle more drivers, adjust:

```typescript
driverCount: 10000,  // 10x increase

// Also increase Lambda concurrency
reservedConcurrentExecutions: 100,  // from 50

// And Kinesis shards
shardCount: 8,  // from 4
```

Cost will scale approximately linearly with driver count.

## Troubleshooting

### IoT Connection Issues

```bash
# Check IoT policy
aws iot get-policy --policy-name location-updates-policy

# Test connection
mosquitto_pub \
  --cert driver-cert.pem \
  --key driver-key.pem \
  --cafile AmazonRootCA1.pem \
  -h $IOT_ENDPOINT \
  -p 8883 \
  -t "driver/test/location" \
  -m '{"test": true}'
```

### Lambda Timeout

If Lambdas are timing out:
1. Check VPC security groups
2. Verify NAT Gateway is working
3. Increase timeout (max 15 minutes)
4. Add more memory

### DynamoDB Throttling

If you see throttles:
1. Switch to provisioned capacity
2. Increase WCU/RCU
3. Or keep on-demand (more expensive but no throttles)

### High Costs

If costs are higher than expected:
1. Check for unused resources
2. Review CloudWatch costs (can be high)
3. Reduce Kinesis retention
4. Use smaller ElastiCache instances

## Clean Up

**Important**: Delete resources to avoid charges

```bash
# Destroy everything
cdktf destroy

# Confirm with 'yes'
```

Manual cleanup if needed:
```bash
# Delete S3 buckets (must be empty first)
aws s3 rb s3://location-snapshots-dev --force --region us-east-1

# Delete CloudWatch log groups
aws logs delete-log-group --log-group-name /aws/lambda/location-processor-dev --region us-east-1
```

## Next Steps

1. **Add more regions**: Extend to 5-10 regions
2. **Increase load**: Test with 10,000 drivers
3. **Custom dashboards**: Add business metrics
4. **Alerting**: Set up PagerDuty/Slack integration
5. **Cost optimization**: Implement the strategies from COST_ANALYSIS.md

## Learning Resources

- [Architecture Guide](../../docs/ARCHITECTURE.md)
- [Component Documentation](../../docs/COMPONENTS.md)
- [Cost Analysis](../../docs/COST_ANALYSIS.md)
- [Performance Tuning](../../docs/PERFORMANCE.md)

## Questions?

Open an issue on GitHub or check the Discussions section.

---

**Happy Learning!** 🚀
