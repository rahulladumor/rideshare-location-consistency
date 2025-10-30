---
name: Bug Report
about: Report a bug or issue with the infrastructure
title: '[BUG] '
labels: bug
assignees: ''
---

## Bug Description

A clear and concise description of what the bug is.

## To Reproduce

Steps to reproduce the behavior:

1. Deploy with configuration '...'
2. Run command '....'
3. See error '....'

## Expected Behavior

A clear and concise description of what you expected to happen.

## Actual Behavior

What actually happened.

## Environment

- **Node Version**: [e.g., 18.0.0]
- **CDKTF Version**: [e.g., 0.20.0]
- **Terraform Version**: [e.g., 1.5.0]
- **AWS Region**: [e.g., us-east-1]
- **Operating System**: [e.g., macOS 14.0]

## Configuration

```typescript
// Relevant configuration from your tap-stack.ts
{
  environment: 'dev',
  regions: ['us-east-1', 'us-west-2'],
  driverCount: 1000
}
```

## Error Logs

```
Paste relevant error logs here
```

## Screenshots

If applicable, add screenshots to help explain your problem.

## Additional Context

Add any other context about the problem here.

## Attempted Solutions

What have you tried to fix this?

- [ ] Checked documentation
- [ ] Searched existing issues
- [ ] Tried destroying and redeploying
- [ ] Verified AWS credentials
- [ ] Checked AWS service quotas
