import { Construct } from 'constructs';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { DynamodbTable } from '@cdktf/provider-aws/lib/dynamodb-table';
import { ElasticacheReplicationGroup } from '@cdktf/provider-aws/lib/elasticache-replication-group';
import { KmsKey } from '@cdktf/provider-aws/lib/kms-key';
import { KmsAlias } from '@cdktf/provider-aws/lib/kms-alias';
import { ElasticacheSubnetGroup } from '@cdktf/provider-aws/lib/elasticache-subnet-group';
import { Subnet } from '@cdktf/provider-aws/lib/subnet';
import { Vpc } from '@cdktf/provider-aws/lib/vpc';
import { SecurityGroup } from '@cdktf/provider-aws/lib/security-group';
import { InternetGateway } from '@cdktf/provider-aws/lib/internet-gateway';
import { Eip } from '@cdktf/provider-aws/lib/eip';
import { NatGateway } from '@cdktf/provider-aws/lib/nat-gateway';
import { RouteTable } from '@cdktf/provider-aws/lib/route-table';
import { RouteTableAssociation } from '@cdktf/provider-aws/lib/route-table-association';
import { Route } from '@cdktf/provider-aws/lib/route';

export interface StorageLayerProps {
  providers: Map<string, AwsProvider>;
  regions: string[];
  primaryRegion: string;
  tableName: string;
  environment: string;
}

export class StorageLayer extends Construct {
  public readonly tableName: string;
  public readonly tableArn: string;
  public readonly streamArns: Map<string, string>;
  public readonly elastiCacheClusters: Map<string, ElasticacheReplicationGroup>;
  public readonly vpcs: Map<string, Vpc>;
  public readonly privateSubnets: Map<string, Subnet[]>;
  public readonly lambdaSecurityGroups: Map<string, SecurityGroup>;
  public readonly kmsKeys: Map<string, KmsKey>;

  constructor(scope: Construct, id: string, props: StorageLayerProps) {
    super(scope, id);

    this.tableName = props.tableName;
    this.streamArns = new Map();
    this.elastiCacheClusters = new Map();
    this.vpcs = new Map();
    this.privateSubnets = new Map();
    this.lambdaSecurityGroups = new Map();
    this.kmsKeys = new Map();

    // Create per-region KMS keys
    props.providers.forEach((provider, region) => {
      const kmsKey = new KmsKey(this, `kms-${region}`, {
        provider,
        description: `Encryption key for ${region} ${props.environment}`,
        enableKeyRotation: true,
        deletionWindowInDays: props.environment === 'production' ? 30 : 7,
        tags: {
          Environment: props.environment,
          Region: region,
        },
      });

      new KmsAlias(this, `kms-alias-${region}`, {
        provider,
        name: `alias/location-${region}-${props.environment}`,
        targetKeyId: kmsKey.keyId,
      });

      this.kmsKeys.set(region, kmsKey);
    });

    // Create per-region DynamoDB tables with streams
    const tables: Map<string, DynamodbTable> = new Map();

    props.providers.forEach((provider, region) => {
      const table = new DynamodbTable(this, `table-${region}`, {
        provider,
        name: `${props.tableName}-${region}-${props.environment}`,
        billingMode: 'PAY_PER_REQUEST',
        hashKey: 'driverId',
        attribute: [
          { name: 'driverId', type: 'S' },
          { name: 'city', type: 'S' },
          { name: 'timestamp', type: 'N' },
        ],
        globalSecondaryIndex: [
          {
            name: 'city-timestamp-index',
            hashKey: 'city',
            rangeKey: 'timestamp',
            projectionType: 'ALL',
          },
        ],
        streamEnabled: true,
        streamViewType: 'NEW_AND_OLD_IMAGES',
        serverSideEncryption: {
          enabled: true,
        },
        pointInTimeRecovery: {
          enabled: true,
        },
        tags: {
          Environment: props.environment,
          Region: region,
        },
      });

      tables.set(region, table);
      this.streamArns.set(region, table.streamArn);
    });

    // Use primary region table ARN as the main reference
    this.tableArn = tables.get(props.primaryRegion)!.arn;

    // Create ElastiCache clusters in each region
    props.providers.forEach((provider, region) => {
      // VPC for ElastiCache
      const vpc = new Vpc(this, `vpc-${region}`, {
        provider,
        cidrBlock: '10.0.0.0/16',
        enableDnsHostnames: true,
        enableDnsSupport: true,
        tags: {
          Name: `elasticache-vpc-${region}-${props.environment}`,
        },
      });

      // Subnets for ElastiCache
      const subnet1 = new Subnet(this, `subnet1-${region}`, {
        provider,
        vpcId: vpc.id,
        cidrBlock: '10.0.1.0/24',
        availabilityZone: `${region}a`,
        tags: {
          Name: `elasticache-subnet1-${region}-${props.environment}`,
        },
      });

      const subnet2 = new Subnet(this, `subnet2-${region}`, {
        provider,
        vpcId: vpc.id,
        cidrBlock: '10.0.2.0/24',
        availabilityZone: `${region}b`,
        tags: {
          Name: `elasticache-subnet2-${region}-${props.environment}`,
        },
      });

      const subnet3 = new Subnet(this, `subnet3-${region}`, {
        provider,
        vpcId: vpc.id,
        cidrBlock: '10.0.3.0/24',
        availabilityZone: `${region}c`,
        tags: {
          Name: `elasticache-subnet3-${region}-${props.environment}`,
        },
      });

      // Internet Gateway for public connectivity
      const igw = new InternetGateway(this, `igw-${region}`, {
        provider,
        vpcId: vpc.id,
        tags: {
          Name: `${props.environment}-igw-${region}`,
        },
      });

      // Public subnet for NAT Gateway
      const publicSubnet = new Subnet(this, `public-subnet-${region}`, {
        provider,
        vpcId: vpc.id,
        cidrBlock: '10.0.0.0/24',
        availabilityZone: `${region}a`,
        mapPublicIpOnLaunch: true,
        tags: {
          Name: `${props.environment}-public-subnet-${region}`,
        },
      });

      // Elastic IP for NAT Gateway
      const eip = new Eip(this, `nat-eip-${region}`, {
        provider,
        domain: 'vpc',
        tags: {
          Name: `${props.environment}-nat-eip-${region}`,
        },
      });

      // NAT Gateway for private subnet internet access
      const natGateway = new NatGateway(this, `nat-${region}`, {
        provider,
        allocationId: eip.id,
        subnetId: publicSubnet.id,
        tags: {
          Name: `${props.environment}-nat-${region}`,
        },
      });

      // Public route table
      const publicRouteTable = new RouteTable(this, `public-rt-${region}`, {
        provider,
        vpcId: vpc.id,
        tags: {
          Name: `${props.environment}-public-rt-${region}`,
        },
      });

      new Route(this, `public-route-${region}`, {
        provider,
        routeTableId: publicRouteTable.id,
        destinationCidrBlock: '0.0.0.0/0',
        gatewayId: igw.id,
      });

      new RouteTableAssociation(this, `public-rt-assoc-${region}`, {
        provider,
        subnetId: publicSubnet.id,
        routeTableId: publicRouteTable.id,
      });

      // Private route table
      const privateRouteTable = new RouteTable(this, `private-rt-${region}`, {
        provider,
        vpcId: vpc.id,
        tags: {
          Name: `${props.environment}-private-rt-${region}`,
        },
      });

      new Route(this, `private-route-${region}`, {
        provider,
        routeTableId: privateRouteTable.id,
        destinationCidrBlock: '0.0.0.0/0',
        natGatewayId: natGateway.id,
      });

      // Associate private subnets with private route table
      [subnet1, subnet2, subnet3].forEach((subnet, idx) => {
        new RouteTableAssociation(this, `private-rt-assoc-${region}-${idx}`, {
          provider,
          subnetId: subnet.id,
          routeTableId: privateRouteTable.id,
        });
      });

      // Store VPC and subnets for Lambda functions
      this.vpcs.set(region, vpc);
      this.privateSubnets.set(region, [subnet1, subnet2, subnet3]);

      const subnetGroup = new ElasticacheSubnetGroup(
        this,
        `subnet-group-${region}`,
        {
          provider,
          name: `elasticache-subnet-${region}-${props.environment}`,
          subnetIds: [subnet1.id, subnet2.id],
        }
      );

      // Security group for ElastiCache
      const securityGroup = new SecurityGroup(
        this,
        `security-group-${region}`,
        {
          provider,
          vpcId: vpc.id,
          namePrefix: `elasticache-sg-${region}-${props.environment}-`,
          ingress: [
            {
              fromPort: 6379,
              toPort: 6379,
              protocol: 'tcp',
              cidrBlocks: ['10.0.0.0/16'],
            },
          ],
          egress: [
            {
              fromPort: 0,
              toPort: 0,
              protocol: '-1',
              cidrBlocks: ['0.0.0.0/0'],
            },
          ],
        }
      );

      // Lambda security group (can access ElastiCache)
      const lambdaSg = new SecurityGroup(this, `lambda-sg-${region}`, {
        provider,
        vpcId: vpc.id,
        namePrefix: `lambda-sg-${region}-${props.environment}-`,
        egress: [
          {
            fromPort: 0,
            toPort: 0,
            protocol: '-1',
            cidrBlocks: ['0.0.0.0/0'],
          },
        ],
      });

      this.lambdaSecurityGroups.set(region, lambdaSg);

      // ElastiCache Redis cluster with geospatial support (cluster mode enabled)
      const elastiCache = new ElasticacheReplicationGroup(
        this,
        `cache-${region}`,
        {
          provider,
          replicationGroupId: `location-cache-${region}-${props.environment}`,
          description: `Driver location cache for ${region}`,
          engine: 'redis',
          engineVersion: '7.0',
          nodeType: 'cache.r6g.2xlarge',
          numNodeGroups: 3,
          replicasPerNodeGroup: 1,
          automaticFailoverEnabled: true,
          multiAzEnabled: true,
          subnetGroupName: subnetGroup.name,
          securityGroupIds: [securityGroup.id],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          atRestEncryptionEnabled: true as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          transitEncryptionEnabled: true as any,
          snapshotRetentionLimit: 7,
          snapshotWindow: '03:00-05:00',
          maintenanceWindow: 'sun:05:00-sun:07:00',
          tags: {
            Environment: props.environment,
            Region: region,
          },
        }
      );

      this.elastiCacheClusters.set(region, elastiCache);
    });
  }
}
