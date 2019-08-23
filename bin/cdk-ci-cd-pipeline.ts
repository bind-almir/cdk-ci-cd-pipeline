#!/usr/bin/env node
import 'source-map-support/register';
import { CdkCiCdPipelineStack } from '../lib/cdk-ci-cd-pipeline-stack';
import { App } from '@aws-cdk/core';

const app = new App();

new CdkCiCdPipelineStack(app, 'PipelineStack', {
  domainName: app.node.tryGetContext('domain'),
  env: {
    account: app.node.tryGetContext('account'), 
    region: app.node.tryGetContext('region')
  }
});

app.synth();

