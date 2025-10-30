# Component Documentation

Detailed documentation for each infrastructure component in the location consistency system.

## Table of Contents

1. [LocationIngestion](#locationingestion)
2. [StorageLayer](#storagelayer)
3. [StreamProcessing](#streamprocessing)
4. [GraphLayer](#graphlayer)
5. [ConsistencyChecker](#consistencychecker)
6. [CorrectionSystem](#correctionsystem)
7. [Monitoring](#monitoring)

---

## LocationIngestion

**File**: `src/constructs/location-ingestion.ts`

**Purpose**: Handle incoming location updates from driver mobile apps via IoT Core and Lambda.

### Architecture

```
Driver App → AWS IoT Core → IoT Rule → Lambda Function → DynamoDB
```

### Key Resources

#### 1. IoT Core Endpoint

```typescript
const iotEndpoint = new DataAwsIotEndpoint(this, 'iot-endpoint', {
  endpointType: 'iot:Data-ATS'
});
```

**What it does**: Provides the MQTT endpoint for drivers to connect

**Output**: `a1b2c3d4e5f6g7-ats.iot.us-east-1.amazonaws.com`

#### 2. IoT Topic Rule

```typescript
const locationRule = new IotTopicRule(this, 'location-rule', {
  name: `driver_location_updates_${environment}`,
  enabled: true,
  sql: "SELECT * FROM 'driver/+/location'",
  sqlVersion: '2016-03-23',
  lambda: [{ functionArn: processorFunction.arn }]
});
```

**Topic Pattern**: `driver/<driver-id>/location`

**SQL Rule**: Captures all messages matching the pattern

**Example Message**:
```json
{
  "driverId": "driver-12345",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "timestamp": 1698765432000,
  "city": "san-francisco",
  "accuracy": 10,
  "speed": 45,
  "heading": 270
}
```

#### 3. Location Processor Lambda

```typescript
const processorFunction = new LambdaFunction(this, 'processor-function', {
  functionName: `location-processor-${environment}`,
  runtime: 'nodejs20.x',
  handler: 'index.handler',
  timeout: 3,
  memorySize: 3008,
  reservedConcurrentExecutions: 50
});
```

**Concurrency**: 50 reserved executions (can handle 5,000 req/sec)

**Memory**: 3008 MB for maximum performance

**Timeout**: 3 seconds (writes should complete in < 50ms)

### Lambda Function Logic

```javascript
exports.handler = async (event) => {
  const { driverId, latitude, longitude, city, timestamp } = event;
  
  // Validation
  if (!driverId || !latitude || !longitude) {
    throw new Error('Missing required fields');
  }
  
  if (latitude < -90 || latitude > 90) {
    throw new Error('Invalid latitude');
  }
  
  if (longitude < -180 || longitude > 180) {
    throw new Error('Invalid longitude');
  }
  
  // Conditional write - prevent stale updates
  const params = {
    TableName: process.env.DYNAMO_TABLE_NAME,
    Item: {
      driverId: { S: driverId },
      timestamp: { N: timestamp.toString() },
      latitude: { N: latitude.toString() },
      longitude: { N: longitude.toString() },
      city: { S: city }
    },
    ConditionExpression: 'attribute_not_exists(driverId) OR #ts < :newTimestamp',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: { ':newTimestamp': { N: timestamp.toString() } }
  };
  
  const startTime = Date.now();
  await dynamodb.send(new PutItemCommand(params));
  const duration = Date.now() - startTime;
  
  if (duration > 50) {
    console.warn(`Slow write: ${duration}ms`);
  }
  
  return { statusCode: 200, latency: duration };
};
```

### IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:ConditionCheckItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/driver-locations-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### Configuration Options

```typescript
interface LocationIngestionProps {
  provider: AwsProvider;
  driverCount: number;              // For capacity planning
  dynamoTableName: string;
  dynamoTableArn: string;
  environment: string;
  maxThroughput: number;            // Messages per second
}
```

### Testing

```bash
# Publish test message
aws iot-data publish \
  --topic "driver/test-001/location" \
  --payload '{
    "driverId": "test-001",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "city": "san-francisco",
    "timestamp": 1698765432000
  }'

# Check Lambda logs
aws logs tail /aws/lambda/location-processor-dev --follow

# Verify DynamoDB write
aws dynamodb get-item \
  --table-name driver-locations-us-east-1-dev \
  --key '{"driverId": {"S": "test-001"}}'
```

---

## StorageLayer

**File**: `src/constructs/storage-layer.ts`

**Purpose**: Store location data with global replication and geospatial indexing.

### Architecture

```
DynamoDB Global Table (Multi-Region)
    ↓
DynamoDB Streams
    ↓
ElastiCache Redis (Per Region)
```

### Key Resources

#### 1. DynamoDB Global Table

```typescript
const table = new DynamodbTable(this, `table-${region}`, {
  name: `${tableName}-${region}-${environment}`,
  billingMode: 'PAY_PER_REQUEST',
  hashKey: 'driverId',
  attribute: [
    { name: 'driverId', type: 'S' },
    { name: 'city', type: 'S' },
    { name: 'timestamp', type: 'N' }
  ],
  globalSecondaryIndex: [{
    name: 'city-timestamp-index',
    hashKey: 'city',
    rangeKey: 'timestamp',
    projectionType: 'ALL'
  }],
  streamEnabled: true,
  streamViewType: 'NEW_AND_OLD_IMAGES',
  pointInTimeRecovery: { enabled: true }
});
```

**Table Structure**:

| Attribute | Type | Purpose |
|-----------|------|---------|
| driverId | String (PK) | Unique driver identifier |
| timestamp | Number (SK) | Unix epoch milliseconds |
| latitude | Number | -90 to 90 |
| longitude | Number | -180 to 180 |
| city | String (GSI-PK) | City identifier |
| accuracy | Number | GPS accuracy in meters |
| speed | Number | Speed in km/h |
| heading | Number | Direction 0-360 degrees |
| battery | Number | Battery percentage |
| status | String | active, idle, offline |

**Indexes**:
- Primary: `driverId` + `timestamp` (for driver history)
- GSI: `city` + `timestamp` (for city-wide queries)

**Capacity**: On-demand (automatically scales)

**Replication**: Asynchronous multi-region (< 1 second)

#### 2. KMS Encryption Keys

```typescript
const kmsKey = new KmsKey(this, `kms-${region}`, {
  description: `Encryption key for ${region} ${environment}`,
  enableKeyRotation: true,
  deletionWindowInDays: environment === 'production' ? 30 : 7
});
```

**Per-Region Keys**: Each region has its own KMS key for data encryption

**Rotation**: Automatic annual rotation enabled

**Deletion Protection**: 30 days for production, 7 days for dev/staging

#### 3. ElastiCache Redis Cluster

```typescript
const cacheCluster = new ElasticacheReplicationGroup(this, `cache-${region}`, {
  replicationGroupId: `location-cache-${region}-${environment}`,
  replicationGroupDescription: `Location cache for ${region}`,
  engine: 'redis',
  engineVersion: '7.0',
  nodeType: 'cache.r6g.large',
  numCacheClusters: 2,  // Primary + replica
  automaticFailoverEnabled: true,
  multiAzEnabled: true,
  port: 6379,
  atRestEncryptionEnabled: true,
  transitEncryptionEnabled: true
});
```

**Node Type**: cache.r6g.large (13.07 GB memory, 2 vCPUs)

**Multi-AZ**: Primary and replica in different AZs

**Encryption**: Both at-rest and in-transit

**Failover**: Automatic (< 60 seconds)

### Redis Data Model

```redis
# Geospatial index
GEOADD location-index <longitude> <latitude> <driverId>

# Example
GEOADD location-index -122.4194 37.7749 driver-12345

# Query nearby drivers
GEORADIUS location-index -122.4194 37.7749 5 km WITHDIST

# Output:
# 1) "driver-12345"  2) "0.0000"
# 2) "driver-67890"  2) "3.2145"
# 3) "driver-11111"  2) "4.8765"
```

### VPC Configuration

```typescript
const vpc = new Vpc(this, `vpc-${region}`, {
  cidrBlock: '10.0.0.0/16',
  enableDnsHostnames: true,
  enableDnsSupport: true
});

const privateSubnet1 = new Subnet(this, `private-subnet-1-${region}`, {
  vpcId: vpc.id,
  cidrBlock: '10.0.1.0/24',
  availabilityZone: `${region}a`
});

const privateSubnet2 = new Subnet(this, `private-subnet-2-${region}`, {
  vpcId: vpc.id,
  cidrBlock: '10.0.2.0/24',
  availabilityZone: `${region}b`
});
```

**CIDR**: 10.0.0.0/16 (65,536 IPs)

**Subnets**: 2 private subnets across 2 AZs

**NAT Gateway**: For Lambda internet access

### Security Groups

```typescript
const cacheSecurityGroup = new SecurityGroup(this, `cache-sg-${region}`, {
  vpcId: vpc.id,
  ingress: [{
    fromPort: 6379,
    toPort: 6379,
    protocol: 'tcp',
    securityGroups: [lambdaSecurityGroup.id]
  }]
});
```

**Principle**: Least-privilege access

**Lambda → ElastiCache**: Port 6379 (Redis)

**Lambda → Neptune**: Port 8182 (Gremlin)

### Testing

```bash
# Test DynamoDB write
aws dynamodb put-item \
  --table-name driver-locations-us-east-1-dev \
  --item '{
    "driverId": {"S": "test-001"},
    "timestamp": {"N": "1698765432000"},
    "latitude": {"N": "37.7749"},
    "longitude": {"N": "-122.4194"},
    "city": {"S": "san-francisco"}
  }'

# Verify replication to other regions
aws dynamodb get-item \
  --table-name driver-locations-us-west-2-dev \
  --key '{"driverId": {"S": "test-001"}}' \
  --region us-west-2

# Test ElastiCache (requires VPC access)
redis-cli -h <cache-endpoint> -p 6379 --tls
GEOADD location-index -122.4194 37.7749 test-001
GEORADIUS location-index -122.4194 37.7749 10 km
```

---

## StreamProcessing

**File**: `src/constructs/stream-processing.ts`

**Purpose**: Process DynamoDB stream events and update ElastiCache and Neptune.

### Architecture

```
DynamoDB Streams → Lambda (Cache Updater) → ElastiCache
                                          → Kinesis Stream
                                          
Kinesis Stream → Lambda (Graph Updater) → Neptune
```

### Cache Updater Lambda

Processes DynamoDB stream events and updates ElastiCache geospatial index.

```typescript
const cacheUpdater = new LambdaFunction(this, `cache-updater-${region}`, {
  functionName: `cache-updater-${region}-${environment}`,
  runtime: 'nodejs20.x',
  handler: 'index.handler',
  timeout: 60,
  memorySize: 1024,
  environment: {
    variables: {
      REDIS_ENDPOINT: cacheCluster.primaryEndpointAddress,
      REDIS_PORT: '6379',
      KINESIS_STREAM: kinesisStream.name
    }
  }
});
```

**Logic**:
```javascript
const Redis = require('ioredis');
const redis = new Redis({
  host: process.env.REDIS_ENDPOINT,
  port: 6379,
  tls: {}
});

exports.handler = async (event) => {
  const records = event.Records;
  const pipeline = redis.pipeline();
  const kinesisRecords = [];
  
  for (const record of records) {
    if (record.eventName === 'INSERT' || record.eventName === 'MODIFY') {
      const newImage = record.dynamodb.NewImage;
      const driverId = newImage.driverId.S;
      const latitude = parseFloat(newImage.latitude.N);
      const longitude = parseFloat(newImage.longitude.N);
      
      // Update geospatial index
      pipeline.geoadd('location-index', longitude, latitude, driverId);
      
      // Prepare Kinesis record
      kinesisRecords.push({
        Data: JSON.stringify({
          driverId,
          latitude,
          longitude,
          timestamp: newImage.timestamp.N,
          city: newImage.city.S,
          eventType: 'location_update'
        }),
        PartitionKey: driverId
      });
    }
  }
  
  // Execute Redis pipeline
  await pipeline.exec();
  
  // Publish to Kinesis
  if (kinesisRecords.length > 0) {
    await kinesis.putRecords({
      StreamName: process.env.KINESIS_STREAM,
      Records: kinesisRecords
    }).promise();
  }
  
  return { processed: records.length };
};
```

### Kinesis Stream Configuration

```typescript
const kinesisStream = new KinesisStream(this, `kinesis-${region}`, {
  name: `location-updates-${region}-${environment}`,
  shardCount: 4,
  retentionPeriod: 24,
  streamModeDetails: {
    streamMode: 'PROVISIONED'
  },
  shardLevelMetrics: [
    'IncomingBytes',
    'IncomingRecords',
    'OutgoingBytes',
    'OutgoingRecords'
  ]
});
```

**Capacity**: 4 shards = 4,000 records/sec

**Retention**: 24 hours

**Monitoring**: Enhanced shard-level metrics

### Graph Updater Lambda

Updates Neptune graph with proximity relationships.

```javascript
const gremlin = require('gremlin');

const client = new gremlin.driver.Client(
  `wss://${process.env.NEPTUNE_ENDPOINT}:8182/gremlin`,
  { traversalSource: 'g' }
);

exports.handler = async (event) => {
  const records = event.Records;
  
  for (const record of records) {
    const data = JSON.parse(Buffer.from(record.kinesis.data, 'base64'));
    const { driverId, latitude, longitude, city } = data;
    
    // Upsert driver vertex
    await client.submit(
      `g.V().has('driver', 'id', driverId)
        .fold()
        .coalesce(
          unfold(),
          addV('driver').property('id', driverId)
        )
        .property('latitude', latitude)
        .property('longitude', longitude)
        .property('city', city)
        .property('updated', timestamp)`,
      { driverId, latitude, longitude, city, timestamp: Date.now() }
    );
    
    // Find nearby riders and create/update proximity edges
    const nearbyRiders = await findNearbyRiders(latitude, longitude, 5); // 5km radius
    
    for (const rider of nearbyRiders) {
      const distance = calculateDistance(latitude, longitude, rider.lat, rider.lon);
      
      await client.submit(
        `g.V().has('driver', 'id', driverId).as('d')
          .V().has('rider', 'id', riderId).as('r')
          .coalesce(
            __.select('d').outE('NEAR').where(inV().as('r')),
            __.select('d').addE('NEAR').to('r')
          )
          .property('distance_km', distance)
          .property('timestamp', timestamp)`,
        { driverId, riderId: rider.id, distance, timestamp: Date.now() }
      );
    }
  }
  
  return { processed: records.length };
};
```

### Event Source Mappings

```typescript
// DynamoDB Stream → Cache Updater
new LambdaEventSourceMapping(this, `stream-mapping-${region}`, {
  eventSourceArn: dynamoStreamArn,
  functionName: cacheUpdater.arn,
  startingPosition: 'TRIM_HORIZON',
  batchSize: 100,
  maximumBatchingWindowInSeconds: 5,
  parallelizationFactor: 2
});

// Kinesis Stream → Graph Updater
new LambdaEventSourceMapping(this, `kinesis-mapping-${region}`, {
  eventSourceArn: kinesisStream.arn,
  functionName: graphUpdater.arn,
  startingPosition: 'LATEST',
  batchSize: 50,
  maximumBatchingWindowInSeconds: 10
});
```

---

## GraphLayer

**File**: `src/constructs/graph-layer.ts`

**Purpose**: Model complex proximity relationships using Amazon Neptune graph database.

(Continued in next section...)
