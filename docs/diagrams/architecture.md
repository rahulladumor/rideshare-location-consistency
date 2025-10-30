# Architecture Diagrams

This document contains all architecture diagrams in Mermaid format. These diagrams are rendered automatically on GitHub.

## Table of Contents

1. [High-Level System Architecture](#high-level-system-architecture)
2. [Data Flow Diagram](#data-flow-diagram)
3. [Consistency Check Workflow](#consistency-check-workflow)
4. [Multi-Region Deployment](#multi-region-deployment)
5. [Component Interaction](#component-interaction)
6. [Drift Detection Flow](#drift-detection-flow)
7. [Self-Healing Process](#self-healing-process)

---

## High-Level System Architecture

```mermaid
graph TB
    subgraph "Driver Mobile Apps"
        A[156,000 Drivers]
    end
    
    subgraph "Ingestion Layer"
        B[AWS IoT Core<br/>5,200 msg/sec]
        C[IoT Rule]
        D[Lambda: Location Writer<br/>< 50ms latency]
    end
    
    subgraph "Storage Layer - Multi-Region"
        E[DynamoDB Global Table<br/>driver-locations]
        F1[ElastiCache Redis<br/>Region 1]
        F2[ElastiCache Redis<br/>Region 2]
        F3[ElastiCache Redis<br/>Region N]
    end
    
    subgraph "Stream Processing"
        G[DynamoDB Streams]
        H1[Lambda: Cache Updater<br/>Region 1]
        H2[Lambda: Cache Updater<br/>Region 2]
        H3[Lambda: Cache Updater<br/>Region N]
        I1[Kinesis Stream<br/>Region 1]
        I2[Kinesis Stream<br/>Region 2]
        I3[Kinesis Stream<br/>Region N]
    end
    
    subgraph "Graph Layer"
        J1[Lambda: Graph Updater]
        J2[Lambda: Graph Updater]
        J3[Lambda: Graph Updater]
        K1[Neptune<br/>Region 1]
        K2[Neptune<br/>Region 2]
        K3[Neptune<br/>Region N]
    end
    
    subgraph "Consistency Layer"
        L[EventBridge<br/>Every 10 seconds]
        M[Step Functions<br/>Orchestrator]
        N[Lambda: Drift Detector]
        O[S3: Snapshots<br/>Canonical State]
        P[Lambda: Corrector]
    end
    
    subgraph "Monitoring"
        Q[CloudWatch<br/>Metrics & Alarms]
        R[CloudWatch Dashboard]
    end
    
    A -->|MQTT| B
    B -->|Trigger| C
    C -->|Invoke| D
    D -->|Write| E
    E -->|Stream| G
    G -->|Trigger| H1 & H2 & H3
    H1 -->|GEOADD| F1
    H2 -->|GEOADD| F2
    H3 -->|GEOADD| F3
    H1 & H2 & H3 -->|Publish| I1 & I2 & I3
    I1 -->|Trigger| J1
    I2 -->|Trigger| J2
    I3 -->|Trigger| J3
    J1 -->|Update Graph| K1
    J2 -->|Update Graph| K2
    J3 -->|Update Graph| K3
    L -->|Start| M
    M -->|Invoke| N
    N -->|Check Drift| F1 & F2 & F3
    N -->|Drift Found| P
    P -->|Read Snapshot| O
    P -->|Republish| E
    D & H1 & J1 & N & P -->|Metrics| Q
    Q -->|Display| R

    style A fill:#e1f5ff
    style E fill:#ff9999
    style F1 fill:#ffcc99
    style F2 fill:#ffcc99
    style F3 fill:#ffcc99
    style K1 fill:#99ccff
    style K2 fill:#99ccff
    style K3 fill:#99ccff
    style M fill:#cc99ff
    style O fill:#99ff99
```

---

## Data Flow Diagram

```mermaid
sequenceDiagram
    participant Driver as Driver App
    participant IoT as IoT Core
    participant Lambda1 as Location Writer
    participant DDB as DynamoDB
    participant Stream as DynamoDB Streams
    participant Lambda2 as Cache Updater
    participant Redis as ElastiCache
    participant Kinesis as Kinesis Stream
    participant Lambda3 as Graph Updater
    participant Neptune as Neptune Graph
    
    Driver->>IoT: MQTT: {lat, lon, timestamp}
    IoT->>Lambda1: Trigger with payload
    Lambda1->>DDB: PutItem (conditional write)
    DDB-->>Lambda1: Success (25ms)
    Lambda1-->>IoT: Ack
    
    Note over Stream: Change Data Capture
    DDB->>Stream: New/Updated Record
    Stream->>Lambda2: Trigger (batch of 100)
    
    par Update Cache
        Lambda2->>Redis: GEOADD driver:<id> lat lon
        Redis-->>Lambda2: OK (< 5ms)
    and Publish Event
        Lambda2->>Kinesis: PutRecords
        Kinesis-->>Lambda2: Success
    end
    
    Kinesis->>Lambda3: Trigger (batch)
    Lambda3->>Neptune: Gremlin: Update proximity edges
    Neptune-->>Lambda3: Success (150ms)
    
    Note over Redis,Neptune: Total: < 2 seconds end-to-end
```

---

## Consistency Check Workflow

```mermaid
stateDiagram-v2
    [*] --> Scheduled: Every 10 seconds
    
    Scheduled --> FetchStates: EventBridge triggers Step Functions
    
    FetchStates --> CompareRegions: Get ElastiCache states from all regions
    
    CompareRegions --> DriftDetected: Run geofence algorithms
    
    DriftDetected --> NoAction: No drift found
    DriftDetected --> LoadSnapshot: Drift > threshold
    
    LoadSnapshot --> IdentifyCanonical: Read S3 snapshot
    
    IdentifyCanonical --> RepublishData: Find correct state
    
    RepublishData --> UpdateRegions: Write to DynamoDB
    
    UpdateRegions --> PropagateChanges: Streams trigger updates
    
    PropagateChanges --> VerifyCorrection: Check if drift resolved
    
    VerifyCorrection --> Success: Drift < threshold
    VerifyCorrection --> Alert: Still inconsistent
    
    NoAction --> [*]
    Success --> [*]
    Alert --> ManualIntervention
    ManualIntervention --> [*]
    
    note right of FetchStates
        Parallel lambda invocations
        to all 45 regions
    end note
    
    note right of CompareRegions
        Calculate haversine distance
        between region states
    end note
    
    note right of RepublishData
        Uses latest snapshot
        as source of truth
    end note
```

---

## Multi-Region Deployment

```mermaid
graph TB
    subgraph "Global Resources"
        A[IoT Core<br/>us-east-1]
        B[S3 Snapshots<br/>us-east-1]
        C[Step Functions<br/>us-east-1]
    end
    
    subgraph "Region 1: us-east-1"
        D1[DynamoDB<br/>Global Table]
        E1[ElastiCache<br/>Cluster]
        F1[Neptune<br/>Cluster]
        G1[Kinesis<br/>Stream]
        H1[Lambda<br/>Functions]
    end
    
    subgraph "Region 2: us-west-2"
        D2[DynamoDB<br/>Replica]
        E2[ElastiCache<br/>Cluster]
        F2[Neptune<br/>Cluster]
        G2[Kinesis<br/>Stream]
        H2[Lambda<br/>Functions]
    end
    
    subgraph "Region 3: eu-west-1"
        D3[DynamoDB<br/>Replica]
        E3[ElastiCache<br/>Cluster]
        F3[Neptune<br/>Cluster]
        G3[Kinesis<br/>Stream]
        H3[Lambda<br/>Functions]
    end
    
    subgraph "Region N: ap-southeast-1"
        DN[DynamoDB<br/>Replica]
        EN[ElastiCache<br/>Cluster]
        FN[Neptune<br/>Cluster]
        GN[Kinesis<br/>Stream]
        HN[Lambda<br/>Functions]
    end
    
    A -->|Route| D1 & D2 & D3 & DN
    
    D1 <-->|Replicate<br/>< 1 sec| D2
    D2 <-->|Replicate<br/>< 1 sec| D3
    D3 <-->|Replicate<br/>< 1 sec| DN
    
    D1 -->|Stream| H1
    D2 -->|Stream| H2
    D3 -->|Stream| H3
    DN -->|Stream| HN
    
    H1 -->|Update| E1 & G1
    H2 -->|Update| E2 & G2
    H3 -->|Update| E3 & G3
    HN -->|Update| EN & GN
    
    G1 -->|Process| F1
    G2 -->|Process| F2
    G3 -->|Process| F3
    GN -->|Process| FN
    
    C -->|Check| E1 & E2 & E3 & EN
    C -->|Correct| B
    B -->|Restore| D1
    
    style A fill:#ff6b6b
    style B fill:#4ecdc4
    style C fill:#ffe66d
```

---

## Component Interaction

```mermaid
flowchart LR
    subgraph Input
        A[Driver Location<br/>Update]
    end
    
    subgraph Ingestion["1. Ingestion (< 50ms)"]
        B[IoT Core]
        C[Lambda]
    end
    
    subgraph Storage["2. Storage (< 1s)"]
        D[DynamoDB<br/>Global Table]
        E[Multi-Region<br/>Replication]
    end
    
    subgraph Indexing["3. Geospatial (< 2s)"]
        F[DynamoDB<br/>Streams]
        G[Lambda<br/>Cache Updater]
        H[ElastiCache<br/>GEOADD]
    end
    
    subgraph Streaming["4. Streaming (< 2.5s)"]
        I[Kinesis<br/>Stream]
        J[Lambda<br/>Graph Updater]
    end
    
    subgraph Graph["5. Graph (< 3s)"]
        K[Neptune<br/>Proximity Map]
    end
    
    subgraph Consistency["6. Consistency (Every 10s)"]
        L[EventBridge]
        M[Step Functions]
        N[Drift Detector]
    end
    
    subgraph Correction["7. Self-Healing (< 8s)"]
        O[S3 Snapshots]
        P[Corrector<br/>Lambda]
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
    G --> I
    I --> J
    J --> K
    
    L --> M
    M --> N
    N -->|Check| H
    N -->|Drift Found| P
    P -->|Read| O
    P -->|Republish| D
    
    H -.->|Snapshot| O
    
    style A fill:#e1f5ff
    style D fill:#ff9999
    style H fill:#ffcc99
    style K fill:#99ccff
    style M fill:#cc99ff
    style O fill:#99ff99
```

---

## Drift Detection Flow

```mermaid
graph TD
    Start([EventBridge Trigger<br/>Every 10 seconds]) --> FetchAll[Fetch ElastiCache States<br/>from All 45 Regions]
    
    FetchAll --> Parallel{Parallel Lambda<br/>Invocations}
    
    Parallel -->|Region 1| L1[Get GEORADIUS<br/>for sample drivers]
    Parallel -->|Region 2| L2[Get GEORADIUS<br/>for sample drivers]
    Parallel -->|Region 3| L3[Get GEORADIUS<br/>for sample drivers]
    Parallel -->|Region N| LN[Get GEORADIUS<br/>for sample drivers]
    
    L1 & L2 & L3 & LN --> Aggregate[Aggregate Results<br/>in Step Functions]
    
    Aggregate --> Compare[Compare States<br/>Calculate Haversine Distance]
    
    Compare --> CheckThreshold{Drift ><br/>100 meters?}
    
    CheckThreshold -->|No| LogMetric[Log Metrics<br/>Continue Monitoring]
    CheckThreshold -->|Yes| CountRegions{How Many<br/>Regions Drifted?}
    
    CountRegions -->|1-2 regions| MinorDrift[Minor Drift<br/>Alert Only]
    CountRegions -->|3+ regions| MajorDrift[Major Drift<br/>Trigger Correction]
    
    MajorDrift --> LoadSnapshot[Load S3 Snapshot<br/>Latest Canonical State]
    
    LoadSnapshot --> FindDiscrepancy[Identify Incorrect<br/>Region States]
    
    FindDiscrepancy --> Republish[Republish Correct Data<br/>to DynamoDB]
    
    Republish --> Propagate[Propagate via Streams<br/>to ElastiCache]
    
    Propagate --> Verify[Verify Correction<br/>Re-check Drift]
    
    Verify --> Success{Drift<br/>Resolved?}
    
    Success -->|Yes| Complete[Log Success<br/>Update Dashboard]
    Success -->|No| Escalate[Send Alert<br/>Manual Investigation]
    
    LogMetric --> End([End])
    MinorDrift --> End
    Complete --> End
    Escalate --> End
    
    style Start fill:#e1f5ff
    style MajorDrift fill:#ff6b6b
    style LoadSnapshot fill:#4ecdc4
    style Complete fill:#99ff99
    style Escalate fill:#ff9999
```

---

## Self-Healing Process

```mermaid
sequenceDiagram
    participant EB as EventBridge
    participant SF as Step Functions
    participant LD as Lambda: Drift Detector
    participant R1 as ElastiCache Region 1
    participant R2 as ElastiCache Region 2
    participant RN as ElastiCache Region N
    participant S3 as S3 Snapshots
    participant LC as Lambda: Corrector
    participant DDB as DynamoDB
    participant CW as CloudWatch
    
    Note over EB: Triggered every 10 seconds
    
    EB->>SF: Start Execution
    SF->>LD: Invoke Drift Detector
    
    par Fetch States from All Regions
        LD->>R1: GEORADIUS driver:*
        R1-->>LD: Coordinates
        LD->>R2: GEORADIUS driver:*
        R2-->>LD: Coordinates
        LD->>RN: GEORADIUS driver:*
        RN-->>LD: Coordinates
    end
    
    LD->>LD: Calculate drift<br/>(Haversine distance)
    
    alt No Drift Detected
        LD-->>SF: drift_found: false
        SF->>CW: Log metric: drift=0
        SF-->>EB: Complete
    else Drift Detected (> 100m)
        LD-->>SF: drift_found: true<br/>affected_regions: [2, 5, 8]
        
        SF->>LC: Invoke Corrector<br/>with drift details
        
        LC->>S3: GetObject<br/>snapshots/latest.json
        S3-->>LC: Canonical state
        
        LC->>LC: Identify<br/>incorrect data
        
        loop For Each Affected Region
            LC->>DDB: PutItem<br/>correct coordinates
        end
        
        Note over DDB,RN: Streams trigger updates
        
        DDB-->>R1: Update via stream
        DDB-->>R2: Update via stream
        DDB-->>RN: Update via stream
        
        LC->>LD: Re-check drift
        
        LD->>R1: GEORADIUS driver:*
        LD->>R2: GEORADIUS driver:*
        LD->>RN: GEORADIUS driver:*
        
        LD->>LD: Verify correction
        
        alt Correction Successful
            LD-->>SF: correction_success: true
            SF->>CW: Log metric: correction=success
            SF-->>EB: Complete
        else Correction Failed
            LD-->>SF: correction_success: false
            SF->>CW: ALARM: Manual intervention needed
            SF-->>EB: Complete with error
        end
    end
```

---

## AWS Services Integration

```mermaid
mindmap
  root((Location<br/>Consistency<br/>System))
    Compute
      Lambda
        Location Writer
        Cache Updater
        Graph Updater
        Drift Detector
        Corrector
      Step Functions
        Orchestration
        Error Handling
    Storage
      DynamoDB
        Global Tables
        Conditional Writes
        Streams
      ElastiCache
        Redis
        Geospatial
        GEORADIUS
      Neptune
        Graph Database
        Gremlin
        Proximity Map
      S3
        Snapshots
        Archival
        Lifecycle
    Messaging
      IoT Core
        MQTT
        Thing Registry
        Rules Engine
      Kinesis
        Data Streams
        Sharding
        Replay
    Orchestration
      EventBridge
        Scheduled Rules
        Every 10s
        Event Patterns
      Step Functions
        State Machine
        Parallel Tasks
        Error Retry
    Monitoring
      CloudWatch
        Metrics
        Alarms
        Dashboards
      X-Ray
        Tracing
        Service Map
```

---

## Performance Breakdown

```mermaid
gantt
    title End-to-End Latency Breakdown (Per Location Update)
    dateFormat SSS
    axisFormat %L ms
    
    section Ingestion
    IoT Core receive           :a1, 000, 5ms
    IoT Rule trigger          :a2, after a1, 3ms
    Lambda cold start (worst) :a3, after a2, 500ms
    Lambda processing         :a4, after a2, 15ms
    DynamoDB write           :a5, after a4, 20ms
    
    section Replication
    DynamoDB replication     :b1, after a5, 850ms
    
    section Cache Update
    Stream trigger           :c1, after b1, 50ms
    Lambda process batch     :c2, after c1, 100ms
    ElastiCache GEOADD       :c3, after c2, 5ms
    
    section Stream Publishing
    Kinesis PutRecords       :d1, after c2, 50ms
    
    section Graph Update
    Kinesis trigger          :e1, after d1, 100ms
    Lambda graph processor   :e2, after e1, 150ms
    Neptune update           :e3, after e2, 200ms
    
    section Target Lines
    50ms target :milestone, 050, 0ms
    1s replication target :milestone, 1000, 0ms
    2s cache target :milestone, 2000, 0ms
    3s graph target :milestone, 3000, 0ms
```

---

## Cost Distribution

```mermaid
pie title Monthly Cost Breakdown ($35,500 for 156K drivers, 45 regions)
    "Neptune (35%)" : 12600
    "DynamoDB (24%)" : 8500
    "ElastiCache (18%)" : 6300
    "Data Transfer (9%)" : 3200
    "Lambda (7%)" : 2400
    "Kinesis (5%)" : 1800
    "IoT Core (1%)" : 500
    "S3 (1%)" : 200
```

---

These diagrams are embedded in the documentation and render automatically on GitHub. You can also generate PNG versions using the Python diagrams library (see `generate_diagrams.py`).
