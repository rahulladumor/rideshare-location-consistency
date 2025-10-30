# Contributing to Rideshare Location Consistency System

Thank you for your interest in contributing! This is an educational project designed to help people learn about cloud infrastructure and distributed systems.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Coding Standards](#coding-standards)
- [Pull Request Process](#pull-request-process)
- [Community](#community)

## Code of Conduct

### Our Pledge

This is a welcoming learning environment. We pledge to:
- Be respectful and inclusive
- Welcome beginners and their questions
- Provide constructive feedback
- Focus on what's best for the community

### Unacceptable Behavior

- Harassment or discrimination
- Trolling or insulting comments
- Publishing others' private information
- Other unprofessional conduct

## How Can I Contribute?

### Reporting Bugs

Found a bug? Help us fix it:

1. **Check existing issues** - Someone may have already reported it
2. **Create a new issue** with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (Node version, AWS region, etc.)
   - Screenshots or logs if applicable

**Template**:
```markdown
**Bug Description**
Brief description of the issue

**To Reproduce**
1. Step 1
2. Step 2
3. Step 3

**Expected Behavior**
What should happen

**Actual Behavior**
What actually happens

**Environment**
- Node version:
- CDKTF version:
- AWS Region:
- OS:
```

### Suggesting Enhancements

Have an idea? We'd love to hear it:

1. **Check existing discussions** - It might already be planned
2. **Open a discussion** (not an issue) to talk about it
3. **Explain**:
   - What problem does it solve?
   - Who benefits from it?
   - Is it a breaking change?

### Improving Documentation

Documentation improvements are always welcome:

- Fix typos or unclear explanations
- Add more examples
- Create tutorials
- Improve diagrams
- Translate to other languages

### Adding Examples

Help others learn by adding examples:

- Different use cases
- Alternative implementations
- Integration with other services
- Cost optimization techniques

## Development Setup

### Prerequisites

```bash
# Required
node >= 18.0.0
npm >= 9.0.0
terraform >= 1.5.0
cdktf >= 0.20.0
aws-cli >= 2.0

# Optional (for diagrams)
python >= 3.8
diagrams library
graphviz
```

### Setup Steps

1. **Fork the repository** on GitHub

2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/rideshare-location-consistency.git
   cd rideshare-location-consistency
   ```

3. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/ORIGINAL_OWNER/rideshare-location-consistency.git
   ```

4. **Install dependencies**
   ```bash
   npm install
   cdktf get
   ```

5. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Building the Project

```bash
# Compile TypeScript
npm run build

# Synthesize Terraform
npm run synth

# Validate the generated Terraform
cd cdktf.out/stacks/dev
terraform validate
```

## Coding Standards

### TypeScript Style

We follow standard TypeScript conventions:

```typescript
// Good: Use descriptive names
const driverLocationTable = new DynamodbTable(this, 'driver-locations', {
  name: `driver-locations-${environment}`,
  billingMode: 'PAY_PER_REQUEST'
});

// Bad: Cryptic names
const tbl = new DynamodbTable(this, 't1', {
  name: 'tbl1',
  billingMode: 'PAY_PER_REQUEST'
});
```

### Infrastructure Guidelines

1. **Resource Naming**: Use kebab-case with environment suffix
   ```typescript
   `resource-name-${region}-${environment}`
   ```

2. **Tagging**: Always tag resources
   ```typescript
   tags: {
     Environment: environment,
     Project: 'location-consistency',
     ManagedBy: 'cdktf',
     Component: 'storage-layer'
   }
   ```

3. **Security**: Follow AWS best practices
   - Enable encryption at rest and in transit
   - Use least-privilege IAM policies
   - Enable audit logging
   - Block public access by default

4. **Cost Optimization**
   - Use on-demand billing for variable workloads
   - Set appropriate retention periods
   - Use lifecycle policies for S3
   - Right-size instances based on workload

### Documentation Standards

1. **Code Comments**: Explain "why", not "what"
   ```typescript
   // Good: Explains reasoning
   // Use conditional write to prevent stale updates from network delays
   ConditionExpression: '#ts < :newTimestamp'
   
   // Bad: States the obvious
   // Set condition expression
   ConditionExpression: '#ts < :newTimestamp'
   ```

2. **README Updates**: Update README if you change:
   - Prerequisites
   - Setup steps
   - Configuration options
   - Architecture

3. **Architecture Diagrams**: Update if you modify:
   - Component interactions
   - Data flow
   - Infrastructure topology

## Pull Request Process

### Before Submitting

1. **Update your branch**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run tests**
   ```bash
   npm test
   npm run build
   npm run lint
   ```

3. **Update documentation**
   - README if needed
   - Component docs if changed
   - Add comments to complex code

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add ElastiCache connection pooling"
   ```

### Commit Message Format

We use conventional commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `test`: Adding tests
- `chore`: Maintenance tasks

**Examples**:
```bash
feat(storage): add DynamoDB point-in-time recovery
fix(ingestion): handle IoT connection timeouts
docs(architecture): add sequence diagrams
perf(cache): implement connection pooling
```

### Submitting PR

1. **Push your branch**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create Pull Request** on GitHub

3. **Fill out the template**:
   ```markdown
   ## Description
   Brief description of changes

   ## Type of Change
   - [ ] Bug fix
   - [ ] New feature
   - [ ] Documentation update
   - [ ] Performance improvement

   ## Testing
   - [ ] Tests pass locally
   - [ ] Added new tests
   - [ ] Manual testing done

   ## Checklist
   - [ ] Code follows style guidelines
   - [ ] Documentation updated
   - [ ] No breaking changes
   - [ ] Commit messages follow convention
   ```

4. **Respond to feedback** promptly and respectfully

### Review Process

- At least one maintainer review required
- CI/CD must pass
- All discussions must be resolved
- Maintainer will merge when approved

## Community

### Getting Help

- **GitHub Discussions**: Ask questions
- **GitHub Issues**: Report bugs
- **Twitter**: Share your implementations

### Recognition

Contributors are recognized in:
- README contributors section
- Release notes
- Project documentation

### Maintainers

Current maintainers:
- @maintainer1 - Core infrastructure
- @maintainer2 - Documentation
- @maintainer3 - Community management

---

## Thank You!

Your contributions make this project better for everyone learning cloud infrastructure. Whether it's code, documentation, bug reports, or spreading the word - it all helps! 🙏

---

**Questions?** Open a discussion on GitHub or reach out to maintainers.

**First time contributing?** Look for issues labeled `good first issue` or `help wanted`.
