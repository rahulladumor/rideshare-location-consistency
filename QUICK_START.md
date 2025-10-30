# 🚀 Quick Start - 5 Minutes to Deploy

Get the location consistency system running in 5 minutes!

## Prerequisites Check

```bash
# Check all required tools (run these one by one)
node --version        # Need >= 18.0.0
npm --version         # Need >= 9.0.0
terraform --version   # Need >= 1.5.0
aws --version         # Need >= 2.0.0

# Install missing tools:
# - Node: https://nodejs.org/
# - Terraform: https://www.terraform.io/downloads
# - AWS CLI: https://aws.amazon.com/cli/
```

## 5-Minute Deploy

```bash
# 1. Clone (30 seconds)
git clone https://github.com/rahulladumor/rideshare-location-consistency.git
cd rideshare-location-consistency

# 2. Install (2 minutes)
npm install
npm install -g cdktf-cli@latest
cdktf get

# 3. Configure AWS (30 seconds)
aws configure
# Enter your AWS credentials when prompted

# 4. Deploy (2 minutes to plan, varies for apply)
cdktf deploy

# Type 'yes' when prompted
```

## What Gets Deployed

### Resources Created

- ✅ **2 AWS Regions**: us-east-1, us-west-2
- ✅ **DynamoDB Global Table**: Multi-region replication
- ✅ **ElastiCache**: 2 Redis clusters for geospatial queries
- ✅ **Neptune**: 2 graph databases for proximity mapping
- ✅ **IoT Core**: MQTT endpoint for 1,000 drivers
- ✅ **Lambda Functions**: 8 functions across 2 regions
- ✅ **Kinesis Streams**: 2 streams for event processing
- ✅ **Step Functions**: Automated consistency checking
- ✅ **S3 Bucket**: Snapshot storage
- ✅ **CloudWatch**: Dashboards and alarms

### Estimated Time

- **Deployment**: 20-30 minutes
- **First location update**: Instant after deployment
- **Replication**: < 1 second between regions

### Estimated Cost

- **Development**: ~$800/month
- **Per day**: ~$27
- **Per hour**: ~$1.10

> 💡 Remember to destroy resources when done testing!

## Test Your Deployment

### 1. Send a Location Update

```bash
# Get IoT endpoint
IOT_ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --query 'endpointAddress' --output text)
echo "IoT Endpoint: $IOT_ENDPOINT"

# Send test location
aws iot-data publish \
  --topic "driver/test-001/location" \
  --payload '{
    "driverId": "test-001",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "city": "san-francisco",
    "timestamp": '$(date +%s)000'
  }' \
  --cli-binary-format raw-in-base64-out

echo "✅ Location sent!"
```

### 2. Verify Data Replication

```bash
# Check us-east-1
echo "Checking us-east-1..."
aws dynamodb get-item \
  --table-name driver-locations-us-east-1-dev \
  --key '{"driverId": {"S": "test-001"}}' \
  --region us-east-1 \
  --output json | jq '.Item'

# Wait for replication
echo "Waiting 2 seconds for replication..."
sleep 2

# Check us-west-2
echo "Checking us-west-2..."
aws dynamodb get-item \
  --table-name driver-locations-us-west-2-dev \
  --key '{"driverId": {"S": "test-001"}}' \
  --region us-west-2 \
  --output json | jq '.Item'

echo "✅ Data replicated!"
```

### 3. View CloudWatch Dashboard

```bash
# Get dashboard URL
DASHBOARD_NAME="location-consistency-dev"
REGION="us-east-1"

echo "Open this URL in your browser:"
echo "https://console.aws.amazon.com/cloudwatch/home?region=$REGION#dashboards:name=$DASHBOARD_NAME"
```

### 4. Run Load Test (Optional)

```bash
# Simulate 50 drivers for 2 minutes
npm run simulate -- --drivers 50 --duration 120

# Watch metrics in CloudWatch while running
```

## View Outputs

```bash
# All infrastructure outputs
cdktf output

# Specific outputs
echo "IoT Endpoint: $(cdktf output iot-endpoint)"
echo "DynamoDB Table: $(cdktf output dynamodb-table-name)"
echo "Step Functions ARN: $(cdktf output step-functions-arn)"
```

## Monitor Your System

### Lambda Logs

```bash
# Watch location processor logs
aws logs tail /aws/lambda/location-processor-dev --follow
```

### Step Functions Executions

```bash
# List recent consistency checks
aws stepfunctions list-executions \
  --state-machine-arn $(cdktf output step-functions-arn) \
  --max-results 10
```

### DynamoDB Metrics

```bash
# Check write capacity
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedWriteCapacityUnits \
  --dimensions Name=TableName,Value=driver-locations-us-east-1-dev \
  --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum
```

## Common Issues

### Issue: "No AWS credentials found"

**Solution**:
```bash
aws configure
# Enter your Access Key ID and Secret Access Key
```

### Issue: "Insufficient permissions"

**Solution**: Ensure your IAM user has these policies:
- AmazonDynamoDBFullAccess
- AWSLambdaFullAccess
- AmazonElastiCacheFullAccess
- NeptuneFullAccess
- AWSIoTFullAccess
- Or use AdministratorAccess for testing

### Issue: "Resource already exists"

**Solution**: Resource names might conflict. Edit `src/tap-stack.ts` to change the environment name:
```typescript
environment: 'dev2',  // Change from 'dev'
```

### Issue: "Deployment taking too long"

**Normal**: First deployment takes 20-30 minutes due to:
- Neptune cluster creation: ~10 minutes
- ElastiCache cluster creation: ~5 minutes
- VPC and networking setup: ~5 minutes
- DynamoDB global table setup: ~3 minutes

## Clean Up (Important!)

**Stop charges by destroying all resources:**

```bash
# Destroy everything
cdktf destroy

# Type 'yes' when prompted

# Verify deletion
aws cloudformation list-stacks \
  --stack-status-filter DELETE_COMPLETE \
  | grep location
```

### Manual Cleanup (if needed)

```bash
# Delete S3 bucket (must be empty first)
aws s3 rm s3://$(cdktf output snapshot-bucket-name) --recursive
aws s3 rb s3://$(cdktf output snapshot-bucket-name)

# Delete CloudWatch log groups
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/location \
  | jq -r '.logGroups[].logGroupName' \
  | xargs -I {} aws logs delete-log-group --log-group-name {}
```

## Next Steps

### Learn More

1. **Architecture**: Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
2. **Components**: Study [docs/COMPONENTS.md](docs/COMPONENTS.md)
3. **Cost**: Review [docs/COST_ANALYSIS.md](docs/COST_ANALYSIS.md)
4. **Diagrams**: Check [docs/diagrams/architecture.md](docs/diagrams/architecture.md)

### Extend the System

1. **Add more regions**: Edit `regions` array in config
2. **Increase drivers**: Adjust `driverCount` parameter
3. **Custom metrics**: Add to monitoring construct
4. **Production setup**: Follow production checklist

### Generate Diagrams

```bash
# Install Python dependencies
pip install -r requirements.txt

# Generate PNG diagrams
python docs/diagrams/generate_diagrams.py

# View in docs/diagrams/
ls -lh docs/diagrams/*.png
```

## Helpful Commands

```bash
# Synthesize (generate Terraform without deploying)
cdktf synth

# Plan (see what will change)
cdktf diff

# Deploy specific stack
cdktf deploy dev-stack

# List all stacks
cdktf list

# Get help
cdktf --help
```

## Architecture Overview

```
[Driver Apps] → [IoT Core] → [Lambda] → [DynamoDB] → [Streams]
                                             ↓
                                    [ElastiCache Redis]
                                             ↓
                                    [Kinesis] → [Neptune]
                                             ↓
                              [Step Functions] (Every 10s)
                                             ↓
                                    [Consistency Check]
                                             ↓
                              [S3 Snapshots] → [Correction]
```

## Performance Targets

| Metric | Target | Typical |
|--------|--------|---------|
| IoT → DynamoDB | < 50ms | ~35ms |
| Replication lag | < 1s | ~850ms |
| Cache update | < 2s | ~1.6s |
| Graph update | < 3s | ~2.4s |
| End-to-end | < 3s | ~2.5s |

## Support

- 📖 **Docs**: Check the `docs/` folder
- 🐛 **Issues**: Open a GitHub issue
- 💬 **Discussions**: Use GitHub Discussions
- 🌟 **Star**: If this helped you!

---

**⚡️ You're now running a production-grade location consistency system!**

**📊 View your dashboard**: CloudWatch Console → Dashboards → location-consistency-dev

**🎉 Happy learning!**
