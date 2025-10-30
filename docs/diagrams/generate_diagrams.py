#!/usr/bin/env python3
"""
Generate architecture diagrams using the diagrams library.

Installation:
    pip install diagrams

Usage:
    python generate_diagrams.py
    
Output:
    PNG files in the current directory
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb, ElastiCache, Neptune
from diagrams.aws.integration import Eventbridge, StepFunctions
from diagrams.aws.iot import IotCore
from diagrams.aws.analytics import KinesisDataStreams
from diagrams.aws.storage import S3
from diagrams.aws.management import Cloudwatch
from diagrams.aws.network import Route53
from diagrams.onprem.client import Users


def generate_high_level_architecture():
    """Generate the high-level system architecture diagram."""
    with Diagram(
        "High-Level Architecture",
        filename="architecture",
        show=False,
        direction="TB",
        graph_attr={
            "fontsize": "16",
            "bgcolor": "white",
            "pad": "0.5",
        }
    ):
        drivers = Users("156,000 Drivers")
        
        with Cluster("Ingestion Layer"):
            iot = IotCore("IoT Core\n5,200 msg/sec")
            writer = Lambda("Location Writer\n< 50ms")
        
        with Cluster("Storage Layer - Multi-Region"):
            dynamodb = Dynamodb("DynamoDB\nGlobal Table")
            
            with Cluster("Regional Caches"):
                cache1 = ElastiCache("ElastiCache\nRegion 1")
                cache2 = ElastiCache("ElastiCache\nRegion 2")
                cacheN = ElastiCache("ElastiCache\nRegion N")
        
        with Cluster("Stream Processing"):
            with Cluster("Region 1"):
                cache_updater1 = Lambda("Cache Updater")
                kinesis1 = KinesisDataStreams("Kinesis Stream")
                graph_updater1 = Lambda("Graph Updater")
            
            with Cluster("Region 2"):
                cache_updater2 = Lambda("Cache Updater")
                kinesis2 = KinesisDataStreams("Kinesis Stream")
                graph_updater2 = Lambda("Graph Updater")
        
        with Cluster("Graph Layer"):
            neptune1 = Neptune("Neptune\nRegion 1")
            neptune2 = Neptune("Neptune\nRegion 2")
        
        with Cluster("Consistency & Self-Healing"):
            eventbridge = Eventbridge("EventBridge\nEvery 10s")
            stepfunctions = StepFunctions("Step Functions\nOrchestrator")
            drift_detector = Lambda("Drift Detector")
            snapshots = S3("S3 Snapshots")
            corrector = Lambda("Corrector")
        
        with Cluster("Monitoring"):
            cloudwatch = Cloudwatch("CloudWatch\nMetrics & Alarms")
        
        # Data flow
        drivers >> Edge(label="MQTT") >> iot
        iot >> Edge(label="trigger") >> writer
        writer >> Edge(label="write") >> dynamodb
        
        dynamodb >> Edge(label="stream") >> cache_updater1
        dynamodb >> Edge(label="stream") >> cache_updater2
        
        cache_updater1 >> Edge(label="GEOADD") >> cache1
        cache_updater2 >> Edge(label="GEOADD") >> cache2
        
        cache_updater1 >> Edge(label="publish") >> kinesis1
        cache_updater2 >> Edge(label="publish") >> kinesis2
        
        kinesis1 >> Edge(label="trigger") >> graph_updater1
        kinesis2 >> Edge(label="trigger") >> graph_updater2
        
        graph_updater1 >> Edge(label="update") >> neptune1
        graph_updater2 >> Edge(label="update") >> neptune2
        
        eventbridge >> Edge(label="schedule") >> stepfunctions
        stepfunctions >> Edge(label="invoke") >> drift_detector
        drift_detector >> Edge(label="check") >> cache1
        drift_detector >> Edge(label="check") >> cache2
        drift_detector >> Edge(label="drift found") >> corrector
        corrector >> Edge(label="read") >> snapshots
        corrector >> Edge(label="republish") >> dynamodb
        
        # Monitoring
        writer >> cloudwatch
        cache_updater1 >> cloudwatch
        drift_detector >> cloudwatch


def generate_multi_region_architecture():
    """Generate multi-region deployment diagram."""
    with Diagram(
        "Multi-Region Deployment",
        filename="multi_region",
        show=False,
        direction="LR",
        graph_attr={
            "fontsize": "16",
            "bgcolor": "white",
            "pad": "0.5",
        }
    ):
        with Cluster("Global Resources (us-east-1)"):
            iot_global = IotCore("IoT Core")
            s3_global = S3("S3 Snapshots")
            sf_global = StepFunctions("Step Functions")
        
        with Cluster("Region 1: us-east-1"):
            ddb1 = Dynamodb("DynamoDB\nGlobal Table")
            cache1 = ElastiCache("ElastiCache")
            neptune1 = Neptune("Neptune")
            kinesis1 = KinesisDataStreams("Kinesis")
            lambda1 = Lambda("Lambda Functions")
        
        with Cluster("Region 2: us-west-2"):
            ddb2 = Dynamodb("DynamoDB\nReplica")
            cache2 = ElastiCache("ElastiCache")
            neptune2 = Neptune("Neptune")
            kinesis2 = KinesisDataStreams("Kinesis")
            lambda2 = Lambda("Lambda Functions")
        
        with Cluster("Region 3: eu-west-1"):
            ddb3 = Dynamodb("DynamoDB\nReplica")
            cache3 = ElastiCache("ElastiCache")
            neptune3 = Neptune("Neptune")
            kinesis3 = KinesisDataStreams("Kinesis")
            lambda3 = Lambda("Lambda Functions")
        
        # Connections
        iot_global >> Edge(label="route") >> ddb1
        iot_global >> Edge(label="route") >> ddb2
        iot_global >> Edge(label="route") >> ddb3
        
        ddb1 >> Edge(label="replicate\n< 1 sec", style="dotted") >> ddb2
        ddb2 >> Edge(label="replicate\n< 1 sec", style="dotted") >> ddb3
        
        ddb1 >> Edge(label="stream") >> lambda1
        ddb2 >> Edge(label="stream") >> lambda2
        ddb3 >> Edge(label="stream") >> lambda3
        
        lambda1 >> cache1
        lambda1 >> kinesis1
        lambda2 >> cache2
        lambda2 >> kinesis2
        lambda3 >> cache3
        lambda3 >> kinesis3
        
        kinesis1 >> neptune1
        kinesis2 >> neptune2
        kinesis3 >> neptune3
        
        sf_global >> Edge(label="check") >> cache1
        sf_global >> Edge(label="check") >> cache2
        sf_global >> Edge(label="check") >> cache3
        sf_global >> Edge(label="correct") >> s3_global
        s3_global >> Edge(label="restore") >> ddb1


def generate_data_flow():
    """Generate detailed data flow diagram."""
    with Diagram(
        "Data Flow - Location Update",
        filename="data_flow",
        show=False,
        direction="TB",
        graph_attr={
            "fontsize": "16",
            "bgcolor": "white",
            "pad": "0.5",
        }
    ):
        driver = Users("Driver App")
        
        with Cluster("1. Ingestion (< 50ms)"):
            iot = IotCore("IoT Core")
            writer = Lambda("Location Writer")
        
        with Cluster("2. Storage (< 1s)"):
            ddb = Dynamodb("DynamoDB\nGlobal Table")
        
        with Cluster("3. Stream Processing"):
            streams = Dynamodb("DynamoDB\nStreams")
            cache_updater = Lambda("Cache Updater")
        
        with Cluster("4. Geospatial Indexing (< 2s)"):
            redis = ElastiCache("ElastiCache\nGEOADD")
        
        with Cluster("5. Event Publishing"):
            kinesis = KinesisDataStreams("Kinesis Stream")
            graph_updater = Lambda("Graph Updater")
        
        with Cluster("6. Graph Update (< 3s)"):
            neptune = Neptune("Neptune\nProximity Map")
        
        monitoring = Cloudwatch("CloudWatch")
        
        # Flow
        driver >> Edge(label="1. MQTT\n{lat, lon, timestamp}") >> iot
        iot >> Edge(label="2. Trigger") >> writer
        writer >> Edge(label="3. PutItem\n(conditional)") >> ddb
        ddb >> Edge(label="4. Stream\nchange data") >> streams
        streams >> Edge(label="5. Batch\ntrigger") >> cache_updater
        cache_updater >> Edge(label="6a. GEOADD\ndriver:<id>") >> redis
        cache_updater >> Edge(label="6b. PutRecords") >> kinesis
        kinesis >> Edge(label="7. Trigger") >> graph_updater
        graph_updater >> Edge(label="8. Gremlin\nupdate edges") >> neptune
        
        # Monitoring
        writer >> monitoring
        cache_updater >> monitoring
        graph_updater >> monitoring


def generate_consistency_workflow():
    """Generate consistency checking workflow."""
    with Diagram(
        "Consistency Check & Self-Healing",
        filename="consistency_workflow",
        show=False,
        direction="TB",
        graph_attr={
            "fontsize": "16",
            "bgcolor": "white",
            "pad": "0.5",
        }
    ):
        with Cluster("Scheduled Trigger"):
            eventbridge = Eventbridge("EventBridge\nEvery 10 seconds")
        
        with Cluster("Orchestration"):
            stepfunctions = StepFunctions("Step Functions\nState Machine")
        
        with Cluster("Drift Detection"):
            detector = Lambda("Drift Detector\nGeofence Algorithm")
        
        with Cluster("Regional Caches - Checked"):
            cache1 = ElastiCache("Region 1")
            cache2 = ElastiCache("Region 2")
            cache3 = ElastiCache("Region 3")
            cacheN = ElastiCache("Region N")
        
        with Cluster("Correction System"):
            snapshots = S3("S3 Snapshots\nCanonical State")
            corrector = Lambda("Corrector\nRepublish Data")
        
        with Cluster("Target - Corrected"):
            ddb = Dynamodb("DynamoDB\nGlobal Table")
        
        monitoring = Cloudwatch("CloudWatch\nAlerts")
        
        # Workflow
        eventbridge >> Edge(label="1. Trigger") >> stepfunctions
        stepfunctions >> Edge(label="2. Invoke") >> detector
        detector >> Edge(label="3. GEORADIUS\nparallel") >> cache1
        detector >> cache2
        detector >> cache3
        detector >> cacheN
        
        detector >> Edge(label="4. If drift > 100m") >> corrector
        corrector >> Edge(label="5. GetObject") >> snapshots
        corrector >> Edge(label="6. PutItem\ncorrect data") >> ddb
        ddb >> Edge(label="7. Stream\npropagate") >> cache1
        ddb >> cache2
        ddb >> cache3
        ddb >> cacheN
        
        corrector >> Edge(label="8. Log metrics") >> monitoring
        detector >> monitoring


def generate_component_interaction():
    """Generate component interaction diagram."""
    with Diagram(
        "Component Interaction Map",
        filename="component_interaction",
        show=False,
        direction="LR",
        graph_attr={
            "fontsize": "14",
            "bgcolor": "white",
            "pad": "0.5",
            "rankdir": "LR",
        }
    ):
        drivers = Users("156K Drivers")
        
        # Constructs as clusters
        with Cluster("LocationIngestion"):
            iot = IotCore("IoT Core")
            writer = Lambda("Writer Lambda")
        
        with Cluster("StorageLayer"):
            ddb = Dynamodb("DynamoDB")
            cache = ElastiCache("ElastiCache")
        
        with Cluster("StreamProcessing"):
            kinesis = KinesisDataStreams("Kinesis")
            stream_lambda = Lambda("Stream Lambda")
        
        with Cluster("GraphLayer"):
            neptune = Neptune("Neptune")
        
        with Cluster("ConsistencyChecker"):
            eventbridge = Eventbridge("EventBridge")
            stepfunctions = StepFunctions("Step Functions")
        
        with Cluster("CorrectionSystem"):
            s3 = S3("S3 Snapshots")
            corrector = Lambda("Corrector")
        
        with Cluster("Monitoring"):
            cloudwatch = Cloudwatch("CloudWatch")
        
        # Interactions
        drivers >> iot >> writer >> ddb
        ddb >> stream_lambda >> cache
        stream_lambda >> kinesis >> neptune
        
        eventbridge >> stepfunctions >> Edge(label="check") >> cache
        stepfunctions >> Edge(label="correct") >> corrector
        corrector >> s3
        corrector >> ddb
        
        writer >> cloudwatch
        stream_lambda >> cloudwatch
        corrector >> cloudwatch


def generate_all_diagrams():
    """Generate all architecture diagrams."""
    print("Generating diagrams...")
    print("This may take a minute...")
    
    print("\n1. Generating high-level architecture...")
    generate_high_level_architecture()
    print("   ✓ architecture.png")
    
    print("\n2. Generating multi-region architecture...")
    generate_multi_region_architecture()
    print("   ✓ multi_region.png")
    
    print("\n3. Generating data flow diagram...")
    generate_data_flow()
    print("   ✓ data_flow.png")
    
    print("\n4. Generating consistency workflow...")
    generate_consistency_workflow()
    print("   ✓ consistency_workflow.png")
    
    print("\n5. Generating component interaction...")
    generate_component_interaction()
    print("   ✓ component_interaction.png")
    
    print("\n✅ All diagrams generated successfully!")
    print("\nGenerated files:")
    print("  - architecture.png")
    print("  - multi_region.png")
    print("  - data_flow.png")
    print("  - consistency_workflow.png")
    print("  - component_interaction.png")
    print("\nYou can now use these in your documentation!")


if __name__ == "__main__":
    try:
        generate_all_diagrams()
    except ImportError:
        print("❌ Error: 'diagrams' library not installed")
        print("\nPlease install it using:")
        print("  pip install diagrams")
        print("\nYou may also need Graphviz:")
        print("  macOS: brew install graphviz")
        print("  Ubuntu: apt-get install graphviz")
        print("  Windows: choco install graphviz")
    except Exception as e:
        print(f"❌ Error generating diagrams: {e}")
        raise
