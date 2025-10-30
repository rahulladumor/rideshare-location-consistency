# System Architecture

This document provides a comprehensive overview of the real-time location consistency system architecture.

## Table of Contents

1. [Overview](#overview)
2. [Design Principles](#design-principles)
3. [Layer-by-Layer Architecture](#layer-by-layer-architecture)
4. [Data Models](#data-models)
5. [Scalability](#scalability)
6. [High Availability](#high-availability)
7. [Security](#security)
8. [Disaster Recovery](#disaster-recovery)

## Overview

The system is built using a **7-layer architecture** that processes location updates from 156,000 drivers across 45 cities in real-time with end-to-end latency under 3 seconds.

### Key Design Goals

1. **High Throughput**: Handle 5,200 location updates per second
2. **Low Latency**: Sub-second processing at each layer
3. **Global Scale**: Multi-region deployment across 45 cities
4. **Consistency**: Automated drift detection and correction
5. **Reliability**: 99.99% uptime with self-healing capabilities
6. **Cost Efficiency**: Optimize for serverless and pay-per-use

## Design Principles

### 1. Event-Driven Architecture

Every component reacts to events rather than polling:
- Driver location updates trigger IoT rules
- DynamoDB streams trigger cache updates
- Kinesis streams trigger graph updates
- EventBridge schedules consistency checks

### 2. Separation of Concerns

Each layer has a single responsibility:
- **Ingestion**: Accept and validate location data
- **Storage**: Persist data with global replication
- **Indexing**: Optimize for geospatial queries
- **Streaming**: Process change events
- **Graph**: Model proximity relationships
- **Consistency**: Detect and correct drift
- **Monitoring**: Observe system health

### 3. Eventual Consistency with Guarantees

- Writes are immediately consistent within a region
- Cross-region replication happens within 1 second
- Drift detection runs every 10 seconds
- Automated correction within 8 seconds

### 4. Defense in Depth

Multiple layers of reliability:
- IoT Core for durable message delivery
- DynamoDB with point-in-time recovery
- ElastiCache for fast reads even if DynamoDB is slow
- S3 snapshots for disaster recovery
- CloudWatch for monitoring and alerting

## Layer-by-Layer Architecture

### Layer 1: Ingestion Layer

**Components**: IoT Core, Lambda Function

**Purpose**: Accept high-volume location updates from driver mobile apps

**Flow**:
```
Driver App → MQTT → IoT Core → IoT Rule → Lambda → DynamoDB
```

**Key Features**:
- **MQTT Protocol**: Efficient for mobile connectivity
- **IoT Core**: Handles 5,200 messages/second
- **IoT Rules**: SQL-based message routing
- **Lambda**: Processes and validates location data
- **Sub-50ms**: Average write latency

**Configuration**:
```typescript
{
  maxThroughput: 5200,           // messages per second
  lambdaTimeout: 3000,           // 3 seconds
  lambdaMemory: 3008,            // MB
  concurrency: 50                // concurrent executions
}
```

**Scaling**:
- IoT Core: Automatically scales to millions of connections
- Lambda: Scales to 50 concurrent executions (can increase)
- DynamoDB: On-demand billing adapts to traffic

### Layer 2: Storage Layer

**Components**: DynamoDB Global Tables, KMS

**Purpose**: Store driver location data with multi-region replication

**Schema**:
```json
{
  "driverId": "driver-12345",           // Partition key
  "timestamp": 1698765432000,           // Sort key (GSI)
  "latitude": 37.7749,
  "longitude": -122.4194,
  "city": "san-francisco",              // GSI hash key
  "accuracy": 10,                       // meters
  "speed": 45,                          // km/h
  "heading": 270,                       // degrees
  "battery": 85,                        // percentage
  "status": "active"
}
```

**Indexes**:
- **Primary Key**: `driverId` (partition) + `timestamp` (sort)
- **GSI**: `city-timestamp-index` for city-based queries

**Features**:
- **Global Tables**: Automatic multi-region replication
- **Streams**: Capture all changes for downstream processing
- **Conditional Writes**: Prevent stale data overwrites
- **Point-in-Time Recovery**: 35-day backup retention
- **Encryption**: Server-side encryption with KMS

**Replication**:
- Target: < 1 second cross-region replication
- Actual: 850ms at p99
- Conflict Resolution: Last-writer-wins based on timestamp

### Layer 3: Geospatial Indexing Layer

**Components**: ElastiCache (Redis), VPC, Security Groups

**Purpose**: Provide sub-millisecond geospatial queries

**Redis Data Structure**:
```
Key: driver:<driverId>
Type: GEOHASH
Commands:
  - GEOADD location-index <longitude> <latitude> <driverId>
  - GEORADIUS location-index <lon> <lat> <radius> km
  - GEODIST location-index <driver1> <driver2> km
```

**Cluster Configuration**:
```typescript
{
  nodeType: 'cache.r6g.large',     // 13.07 GB memory
  numCacheClusters: 2,              // Multi-AZ
  port: 6379,
  engineVersion: '7.0',
  transitEncryptionEnabled: true,
  atRestEncryptionEnabled: true
}
```

**Operations per Second**:
- GEOADD: ~5,200/sec (from DynamoDB streams)
- GEORADIUS: ~50,000/sec (from API queries)
- Average latency: < 1ms

**Regional Deployment**:
- Each region has its own ElastiCache cluster
- Clusters are independent (no cross-region replication)
- Updated via DynamoDB streams (single source of truth)

### Layer 4: Stream Processing Layer

**Components**: DynamoDB Streams, Kinesis Streams, Lambda Functions

**Purpose**: Process change events and publish to downstream systems

**Processing Pipeline**:
```
DynamoDB Streams → Lambda (Cache Updater) → ElastiCache
                                          → Kinesis Stream
                                          
Kinesis Stream → Lambda (Graph Updater) → Neptune
```

**Cache Updater Lambda**:
```typescript
{
  runtime: 'nodejs20.x',
  timeout: 60,                  // seconds
  memory: 1024,                 // MB
  batchSize: 100,               // records
  batchWindow: 5,               // seconds
  parallelizationFactor: 2
}
```

**Processing Logic**:
1. Read batch of DynamoDB stream records
2. For each NEW_IMAGE or MODIFIED record:
   - Extract driver ID, lat, lon
   - Update ElastiCache: `GEOADD`
   - Publish to Kinesis stream
3. Handle errors with DLQ (Dead Letter Queue)

**Kinesis Configuration**:
```typescript
{
  shardCount: 4,                // per region
  retentionPeriod: 24,          // hours
  enhancedMonitoring: true
}
```

**Throughput**:
- Each shard: 1,000 records/sec
- 4 shards: 4,000 records/sec per region
- Can scale to 100+ shards if needed

### Layer 5: Graph Layer

**Components**: Amazon Neptune, VPC

**Purpose**: Model complex driver-rider-city proximity relationships

**Graph Schema**:
```
Vertices:
  - Driver(id, name, rating)
  - Rider(id, name)
  - City(id, name, timezone)
  - GeoZone(id, polygon)

Edges:
  - NEAR(driver, rider, distance_km, timestamp)
  - LOCATED_IN(driver, city)
  - WITHIN(geozone, city)
  - REQUESTED_BY(trip, rider)
```

**Gremlin Query Examples**:
```groovy
// Find drivers within 5km of rider
g.V().hasLabel('rider').has('id', riderId)
  .out('NEAR').hasLabel('driver')
  .has('distance_km', lt(5))
  .order().by('distance_km', asc)
  .limit(10)

// Update proximity edge
g.V().hasLabel('driver').has('id', driverId)
  .as('d')
  .V().hasLabel('rider').has('id', riderId)
  .as('r')
  .addE('NEAR').from('d').to('r')
  .property('distance_km', distance)
  .property('timestamp', timestamp)
```

**Cluster Configuration**:
```typescript
{
  instanceType: 'db.r5.large',      // 16 GB memory
  instanceCount: 1,                  // per region
  backupRetentionPeriod: 7,         // days
  preferredBackupWindow: '03:00-04:00',
  engineVersion: '1.2.1.0'
}
```

**Performance**:
- Write throughput: 1,000 edges/sec
- Query latency: < 10ms for proximity searches
- Graph size: ~500M edges (156K drivers × 3,200 avg riders)

### Layer 6: Consistency Checking Layer

**Components**: EventBridge, Step Functions, Lambda

**Purpose**: Detect and correct data drift across regions

**Step Functions Workflow**:
```json
{
  "StartAt": "FetchRegionStates",
  "States": {
    "FetchRegionStates": {
      "Type": "Map",
      "ItemsPath": "$.regions",
      "Iterator": {
        "StartAt": "GetCacheState",
        "States": {
          "GetCacheState": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:...:function:drift-detector",
            "End": true
          }
        }
      },
      "Next": "CompareDrift"
    },
    "CompareDrift": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:function:drift-comparator",
      "Next": "CheckThreshold"
    },
    "CheckThreshold": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.driftMeters",
          "NumericGreaterThan": 100,
          "Next": "TriggerCorrection"
        }
      ],
      "Default": "Success"
    },
    "TriggerCorrection": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:function:corrector",
      "Next": "VerifyCorrection"
    },
    "VerifyCorrection": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:function:drift-detector",
      "Next": "Success"
    },
    "Success": {
      "Type": "Succeed"
    }
  }
}
```

**Drift Detection Algorithm**:
```typescript
function calculateDrift(states: RegionState[]): DriftResult {
  const sampleDrivers = selectRandomDrivers(1000);
  let totalDrift = 0;
  let maxDrift = 0;
  let driftCount = 0;
  
  for (const driverId of sampleDrivers) {
    const locations = states.map(s => s.driverLocations[driverId]);
    
    for (let i = 0; i < locations.length - 1; i++) {
      const distance = haversineDistance(
        locations[i],
        locations[i + 1]
      );
      
      if (distance > 100) {  // 100 meter threshold
        totalDrift += distance;
        maxDrift = Math.max(maxDrift, distance);
        driftCount++;
      }
    }
  }
  
  return {
    avgDrift: totalDrift / sampleDrivers.length,
    maxDrift,
    driftPercentage: (driftCount / sampleDrivers.length) * 100
  };
}
```

**Execution**:
- Trigger: Every 10 seconds via EventBridge
- Timeout: 30 seconds
- Cost: ~$0.0025 per execution
- Monthly executions: 259,200 (10s interval)

### Layer 7: Self-Healing Layer

**Components**: S3, Lambda

**Purpose**: Store snapshots and correct drift automatically

**Snapshot Strategy**:
```typescript
// Snapshot every 60 seconds
{
  frequency: '60s',
  retention: 24 * 60 = 1440 snapshots,  // 24 hours
  format: 'json.gz',
  partitioning: 'by-region'
}
```

**Snapshot Structure**:
```json
{
  "timestamp": 1698765432000,
  "region": "us-east-1",
  "driverCount": 156000,
  "drivers": {
    "driver-12345": {
      "latitude": 37.7749,
      "longitude": -122.4194,
      "timestamp": 1698765432000,
      "city": "san-francisco"
    }
  },
  "metadata": {
    "version": "1.0",
    "checksum": "sha256:..."
  }
}
```

**Correction Process**:
1. Drift detected (> 100m for > 5% of drivers)
2. Load latest S3 snapshot
3. Identify incorrect region states
4. Republish correct data to DynamoDB
5. DynamoDB streams propagate to ElastiCache
6. Verify drift resolved
7. Log metrics and alert if failed

**S3 Lifecycle**:
```typescript
{
  transitions: [
    { days: 1, storageClass: 'STANDARD_IA' },
    { days: 7, storageClass: 'GLACIER' }
  ],
  expiration: { days: 30 }
}
```

## Data Models

### Location Update Event

```typescript
interface LocationUpdate {
  driverId: string;
  latitude: number;           // -90 to 90
  longitude: number;          // -180 to 180
  timestamp: number;          // Unix epoch ms
  accuracy: number;           // meters
  speed?: number;             // km/h
  heading?: number;           // 0-360 degrees
  city: string;
  status: 'active' | 'idle' | 'offline';
}
```

### DynamoDB Stream Record

```typescript
interface StreamRecord {
  eventID: string;
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  eventSource: 'aws:dynamodb';
  dynamodb: {
    Keys: { driverId: { S: string } };
    NewImage?: DynamoDBMap;
    OldImage?: DynamoDBMap;
    SequenceNumber: string;
    SizeBytes: number;
    StreamViewType: 'NEW_AND_OLD_IMAGES';
  };
  eventSourceARN: string;
}
```

### Kinesis Record

```typescript
interface KinesisRecord {
  driverId: string;
  latitude: number;
  longitude: number;
  timestamp: number;
  city: string;
  eventType: 'location_update';
  region: string;
}
```

## Scalability

### Vertical Scaling

Each component can scale resources:
- Lambda: 128 MB to 10 GB memory
- ElastiCache: cache.t3.micro to cache.r6g.16xlarge
- Neptune: db.t3.medium to db.r5.24xlarge
- DynamoDB: On-demand automatically scales

### Horizontal Scaling

Add more instances or regions:
- DynamoDB: Add more replicas (up to 20 regions)
- ElastiCache: Add read replicas (up to 5)
- Kinesis: Add shards (up to 500)
- Lambda: Concurrent executions (up to 1,000+)

### Current Capacity

| Component | Current | Peak Capacity |
|-----------|---------|---------------|
| IoT Core | 5,200 msg/sec | 500,000 msg/sec |
| Lambda Writes | 5,200 inv/sec | 50,000 inv/sec |
| DynamoDB | 5,200 WCU | Unlimited |
| ElastiCache | 10,400 ops/sec | 1M ops/sec |
| Kinesis | 20,800 rec/sec | 1M rec/sec |

## High Availability

### Multi-AZ Deployment

All regional resources deployed across 2+ availability zones:
- ElastiCache: 2 nodes (primary + replica)
- Neptune: Automatic failover to replica
- Lambda: Runs in multiple AZs automatically

### Multi-Region Active-Active

All 45 regions actively process traffic:
- DynamoDB global tables replicate to all regions
- Each region has independent compute/cache
- No single point of failure

### Failover Strategy

1. **Region Failure**:
   - Traffic automatically routed to nearest healthy region
   - DynamoDB continues replicating to remaining regions
   - Step Functions checks only healthy regions

2. **AZ Failure**:
   - ElastiCache fails over to replica (< 60 seconds)
   - Neptune fails over to standby (< 30 seconds)
   - Lambda automatically uses remaining AZs

3. **Service Degradation**:
   - Circuit breakers prevent cascading failures
   - Exponential backoff for retries
   - Dead letter queues for failed messages

## Security

### Network Security

- **VPC**: All compute in private subnets
- **Security Groups**: Least-privilege access
- **NACLs**: Additional layer at subnet level
- **PrivateLink**: VPC endpoints for AWS services

### Data Security

- **Encryption at Rest**:
  - DynamoDB: KMS with customer-managed keys
  - ElastiCache: AES-256 encryption
  - Neptune: KMS encrypted storage
  - S3: Server-side encryption with KMS

- **Encryption in Transit**:
  - IoT Core: TLS 1.2+
  - ElastiCache: TLS enabled
  - Neptune: TLS connections only
  - Kinesis: TLS for data upload

### Identity & Access Management

- **IAM Roles**: Least-privilege policies
- **Service-to-Service**: IAM role assumptions only
- **API Authentication**: IoT certificate-based auth
- **Audit Logs**: CloudTrail enabled

## Disaster Recovery

### Recovery Objectives

- **RTO (Recovery Time Objective)**: 15 minutes
- **RPO (Recovery Point Objective)**: 1 minute

### Backup Strategy

| Component | Backup Method | Frequency | Retention |
|-----------|---------------|-----------|-----------|
| DynamoDB | Point-in-time recovery | Continuous | 35 days |
| ElastiCache | Manual snapshots | Daily | 7 days |
| Neptune | Automated backups | Daily | 7 days |
| S3 | Versioning enabled | Real-time | 30 days |

### Disaster Recovery Procedures

1. **Data Loss**:
   - DynamoDB: Restore to any point in last 35 days
   - ElastiCache: Restore from snapshot + replay DynamoDB streams
   - Neptune: Restore from backup + rebuild graph

2. **Region Failure**:
   - Traffic routes to remaining 44 regions automatically
   - No manual intervention required
   - DynamoDB continues multi-region replication

3. **Complete System Failure**:
   - Redeploy infrastructure using IaC (15 minutes)
   - Restore DynamoDB from point-in-time backup
   - Replay DynamoDB streams to rebuild caches/graphs
   - Total recovery: < 30 minutes

---

## Next Steps

- [Component Documentation](./COMPONENTS.md) - Detailed component guides
- [Setup Guide](./SETUP.md) - Deploy the system
- [Performance Tuning](./PERFORMANCE.md) - Optimization techniques
- [Troubleshooting](./TROUBLESHOOTING.md) - Common issues
