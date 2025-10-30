import { Construct } from 'constructs';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { NeptuneCluster } from '@cdktf/provider-aws/lib/neptune-cluster';
import { NeptuneClusterInstance } from '@cdktf/provider-aws/lib/neptune-cluster-instance';
import { NeptuneSubnetGroup } from '@cdktf/provider-aws/lib/neptune-subnet-group';
import { NeptuneClusterParameterGroup } from '@cdktf/provider-aws/lib/neptune-cluster-parameter-group';
import { Vpc } from '@cdktf/provider-aws/lib/vpc';
import { Subnet } from '@cdktf/provider-aws/lib/subnet';
import { SecurityGroup } from '@cdktf/provider-aws/lib/security-group';

export interface GraphLayerProps {
  providers: Map<string, AwsProvider>;
  regions: string[];
  environment: string;
  driverCount: number;
}

export class GraphLayer extends Construct {
  public readonly neptuneEndpoints: Map<string, string>;

  constructor(scope: Construct, id: string, props: GraphLayerProps) {
    super(scope, id);

    this.neptuneEndpoints = new Map();

    props.providers.forEach((provider, region) => {
      // VPC for Neptune
      const vpc = new Vpc(this, `neptune-vpc-${region}`, {
        provider,
        cidrBlock: '10.1.0.0/16',
        enableDnsHostnames: true,
        enableDnsSupport: true,
        tags: {
          Name: `neptune-vpc-${region}-${props.environment}`,
        },
      });

      // Subnets for Neptune
      const subnets: Subnet[] = [];
      const azs = [`${region}a`, `${region}b`, `${region}c`];

      azs.forEach((az, index) => {
        const subnet = new Subnet(this, `neptune-subnet-${region}-${index}`, {
          provider,
          vpcId: vpc.id,
          cidrBlock: `10.1.${index}.0/24`,
          availabilityZone: az,
          tags: {
            Name: `neptune-subnet-${region}-${az}-${props.environment}`,
          },
        });
        subnets.push(subnet);
      });

      // Neptune subnet group
      const subnetGroup = new NeptuneSubnetGroup(
        this,
        `neptune-subnet-group-${region}`,
        {
          provider,
          name: `neptune-subnet-group-${region}-${props.environment}`,
          subnetIds: subnets.map(s => s.id),
          tags: {
            Environment: props.environment,
          },
        }
      );

      // Security group for Neptune
      const securityGroup = new SecurityGroup(this, `neptune-sg-${region}`, {
        provider,
        vpcId: vpc.id,
        namePrefix: `neptune-sg-${region}-${props.environment}-`,
        ingress: [
          {
            fromPort: 8182,
            toPort: 8182,
            protocol: 'tcp',
            cidrBlocks: ['10.0.0.0/8'],
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
      });

      // Neptune parameter group for performance tuning
      const parameterGroup = new NeptuneClusterParameterGroup(
        this,
        `neptune-params-${region}`,
        {
          provider,
          family: 'neptune1.2',
          name: `neptune-params-${region}-${props.environment}`,
          parameter: [
            {
              name: 'neptune_query_timeout',
              value: '120000',
            },
            {
              name: 'neptune_enable_audit_log',
              value: '0',
            },
          ],
        }
      );

      // Neptune cluster
      const neptuneCluster = new NeptuneCluster(
        this,
        `neptune-cluster-${region}`,
        {
          provider,
          clusterIdentifier: `location-graph-${region}-${props.environment}`,
          engine: 'neptune',
          engineVersion: '1.2.0.2',
          neptuneSubnetGroupName: subnetGroup.name,
          vpcSecurityGroupIds: [securityGroup.id],
          neptuneClusterParameterGroupName: parameterGroup.name,
          storageEncrypted: true,
          preferredBackupWindow: '03:00-04:00',
          preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
          backupRetentionPeriod: 7,
          deletionProtection: props.environment === 'production',
          tags: {
            Environment: props.environment,
            Region: region,
          },
        }
      );

      // Neptune instances (3 for high availability)
      const instanceTypes = ['db.r5.2xlarge', 'db.r5.xlarge', 'db.r5.xlarge'];

      instanceTypes.forEach((instanceType, index) => {
        new NeptuneClusterInstance(
          this,
          `neptune-instance-${region}-${index}`,
          {
            provider,
            identifier: `location-graph-${region}-${index}-${props.environment}`,
            clusterIdentifier: neptuneCluster.id,
            instanceClass: instanceType,
            neptuneSubnetGroupName: subnetGroup.name,
            preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
            autoMinorVersionUpgrade: true,
            tags: {
              Environment: props.environment,
              Region: region,
              Role: index === 0 ? 'writer' : 'reader',
            },
          }
        );
      });

      this.neptuneEndpoints.set(region, neptuneCluster.endpoint);
    });
  }
}
