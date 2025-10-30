#!/usr/bin/env node
import { App } from 'cdktf';
import { TapStack } from '../lib/tap-stack';

const app = new App();

// Get environment variables from the environment or use defaults
const environment = process.env.ENVIRONMENT || 'dev';
const primaryRegion = process.env.AWS_REGION || 'us-east-1';
const regionsString = process.env.REGIONS || primaryRegion;
const regions = regionsString.split(',').map(r => r.trim());
const driverCount = parseInt(process.env.DRIVER_COUNT || '156000', 10);

// Calculate the stack name
const stackName = `TapStack-${environment}`;

// Create the TapStack with the calculated properties
new TapStack(app, stackName, {
  environment,
  regions,
  primaryRegion,
  driverCount,
  costCenter: process.env.COST_CENTER || 'location-services',
  owner: process.env.OWNER || 'platform-team',
});

// Synthesize the app to generate the Terraform configuration
app.synth();
