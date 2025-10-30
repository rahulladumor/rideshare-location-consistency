# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: rahuldladumor@gmail.com

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

Please include the following information (as much as you can provide):

* Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
* Full paths of source file(s) related to the manifestation of the issue
* The location of the affected source code (tag/branch/commit or direct URL)
* Any special configuration required to reproduce the issue
* Step-by-step instructions to reproduce the issue
* Proof-of-concept or exploit code (if possible)
* Impact of the issue, including how an attacker might exploit it

This information will help us triage your report more quickly.

## Security Best Practices

When deploying this infrastructure:

### AWS Credentials

- **Never commit AWS credentials** to the repository
- Use IAM roles with least-privilege permissions
- Enable MFA for AWS console access
- Rotate access keys regularly
- Use AWS Secrets Manager for sensitive data

### Infrastructure Security

- **VPC**: All compute resources are in private subnets
- **Encryption**: 
  - At rest: KMS encryption for DynamoDB, ElastiCache, Neptune, S3
  - In transit: TLS 1.2+ for all service communication
- **IAM**: Least-privilege policies for all resources
- **Security Groups**: Restrictive ingress rules
- **Monitoring**: CloudWatch alarms for security events

### Code Security

- Run `npm audit` regularly to check for vulnerabilities
- Keep dependencies up to date
- Review third-party packages before use
- Use TypeScript strict mode for type safety

### Deployment Security

- **Development**: Use separate AWS accounts from production
- **Testing**: Never use production data in test environments
- **Secrets**: Use environment variables or AWS Secrets Manager
- **Access**: Implement least-privilege IAM policies

### Security Checklist

Before deploying to production:

- [ ] Enable CloudTrail for audit logging
- [ ] Configure AWS Config for compliance monitoring
- [ ] Set up AWS GuardDuty for threat detection
- [ ] Enable VPC Flow Logs
- [ ] Configure Security Hub for security standards
- [ ] Review all IAM policies for least privilege
- [ ] Enable encryption for all data stores
- [ ] Configure backup and disaster recovery
- [ ] Set up monitoring and alerting
- [ ] Document security procedures
- [ ] Train team on security best practices
- [ ] Conduct security review

### Known Considerations

#### IoT Core Authentication

- Uses certificate-based authentication
- Certificates should be stored securely
- Implement certificate rotation policy
- Monitor for unauthorized connection attempts

#### DynamoDB Access

- Uses IAM roles for authentication
- Supports fine-grained access control
- Enable point-in-time recovery
- Use encryption at rest

#### ElastiCache/Neptune Access

- Deployed in VPC private subnets
- No public endpoints
- Access only via Lambda in same VPC
- Uses security groups for network isolation

#### Lambda Functions

- Execution roles with minimal permissions
- Environment variables for configuration
- VPC configuration for network isolation
- CloudWatch Logs for monitoring

### Responsible Disclosure

We follow the principle of responsible disclosure:

1. Report received and acknowledged within 48 hours
2. Issue investigated and confirmed
3. Patch developed and tested
4. Security advisory drafted
5. Patch released with security advisory
6. Public disclosure after users have time to update

We appreciate your efforts to responsibly disclose your findings and will make every effort to acknowledge your contributions.

## Security Updates

Security updates will be released as soon as possible after a vulnerability is confirmed. Updates will be announced via:

- GitHub Security Advisories
- Repository releases page
- README security section

## Questions

If you have questions about this security policy, please open a GitHub Discussion or contact the maintainers.

## Attribution

This security policy is based on best practices from:
- [OWASP](https://owasp.org/)
- [AWS Security Best Practices](https://aws.amazon.com/security/best-practices/)
- [GitHub Security Best Practices](https://docs.github.com/en/code-security)
