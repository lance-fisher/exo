// =============================================================================
// Sovereign Operator Console — Secret Redaction Tests
// =============================================================================

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Built-in patterns
// ---------------------------------------------------------------------------

interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const BUILT_IN_RULES: RedactionRule[] = [
  {
    name: 'api_key_openai',
    pattern: /sk-(?:proj-|live-|test-)[a-zA-Z0-9]{10,}/g,
    replacement: '[REDACTED:api_key]',
  },
  {
    name: 'generic_api_key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?([a-zA-Z0-9_\-]{20,})["']?/gi,
    replacement: '[REDACTED:api_key]',
  },
  {
    name: 'password_in_url',
    pattern: /:\/\/([^:]+):(.{3,}?)@(?=[a-zA-Z0-9\[])/g,
    replacement: '://$1:[REDACTED]@',
  },
  {
    name: 'bearer_token',
    pattern: /(Bearer\s+)[a-zA-Z0-9._\-]{20,}/gi,
    replacement: '$1[REDACTED:bearer]',
  },
  {
    name: 'aws_access_key',
    pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
    replacement: '[REDACTED:aws_key]',
  },
  {
    name: 'aws_secret_key',
    pattern: /(?:aws_secret_access_key|secret_access_key)\s*[:=]\s*["']?([a-zA-Z0-9/+=]{30,})["']?/gi,
    replacement: '[REDACTED:aws_secret]',
  },
  {
    name: 'private_key_block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    replacement: '[REDACTED:private_key]',
  },
  {
    name: 'env_value',
    pattern: /^([A-Z][A-Z0-9_]{2,})=(.+)$/gm,
    replacement: '$1=[REDACTED:env_value]',
  },
  {
    name: 'high_entropy',
    pattern: /["'][a-zA-Z0-9+/]{40,}={0,2}["']/g,
    replacement: '"[REDACTED:high_entropy]"',
  },
];

// ---------------------------------------------------------------------------
// Redaction engine
// ---------------------------------------------------------------------------

function redact(content: string, customRules: RedactionRule[] = []): string {
  const rules = [...BUILT_IN_RULES, ...customRules];
  let result = content;

  for (const rule of rules) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    result = result.replace(regex, rule.replacement);
  }

  return result;
}

function redactDiff(diff: string, customRules: RedactionRule[] = []): string {
  // Redact both sides of the diff output
  return redact(diff, customRules);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Secret Redaction — API Keys', () => {
  it('detects and redacts OpenAI-style API keys', () => {
    const input = 'const key = "sk-proj-abc123def456ghi789jkl012mno345";';
    const result = redact(input);

    expect(result).not.toContain('sk-proj-abc123def456ghi789jkl012mno345');
    expect(result).toContain('[REDACTED:api_key]');
  });

  it('detects generic api_key assignments', () => {
    const input = 'api_key = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"';
    const result = redact(input);

    expect(result).toContain('[REDACTED:api_key]');
  });
});

describe('Secret Redaction — Passwords in Connection Strings', () => {
  it('redacts password in PostgreSQL connection URL', () => {
    const input = 'postgresql://admin:SuperSecret123!@db.example.com:5432/production';
    const result = redact(input);

    expect(result).not.toContain('SuperSecret123!');
    expect(result).toContain('://admin:[REDACTED]@');
    expect(result).toContain('db.example.com');
  });

  it('redacts password in MongoDB connection URL', () => {
    const input = 'mongodb://dbuser:p@ssw0rd@cluster.mongodb.net/mydb';
    const result = redact(input);

    expect(result).not.toContain('p@ssw0rd');
    expect(result).toContain('[REDACTED]');
  });
});

describe('Secret Redaction — Bearer Tokens', () => {
  it('redacts Bearer token in authorization header', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = redact(input);

    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(result).toContain('Bearer [REDACTED:bearer]');
  });
});

describe('Secret Redaction — AWS Keys', () => {
  it('redacts AWS access key ID', () => {
    const input = 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE';
    const result = redact(input);

    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result).toContain('[REDACTED:aws_key]');
  });

  it('redacts AWS secret access key', () => {
    const input = 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const result = redact(input);

    expect(result).not.toContain('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    expect(result).toContain('[REDACTED:aws_secret]');
  });
});

describe('Secret Redaction — Private Key Blocks', () => {
  it('redacts PEM private key block', () => {
    const input = `Some text before
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE2I2yPB
aBDwAJBEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrs
-----END RSA PRIVATE KEY-----
Some text after`;
    const result = redact(input);

    expect(result).not.toContain('MIIEpAIBAAKCAQEA');
    expect(result).toContain('[REDACTED:private_key]');
    expect(result).toContain('Some text before');
    expect(result).toContain('Some text after');
  });

  it('redacts EC private key block', () => {
    const input = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIBkg4LVWM9nuwNSk3yByxZpYRTBnVMC0M1vfAq4HkfOpoAcGBSuBBAAi
-----END EC PRIVATE KEY-----`;
    const result = redact(input);

    expect(result).toContain('[REDACTED:private_key]');
    expect(result).not.toContain('MHQCAQEEIBkg4LVWM9nuwNSk3yByxZpYRTBnVMC0M1vf');
  });
});

describe('Secret Redaction — .env Values', () => {
  it('redacts .env file content', () => {
    const input = `DATABASE_URL=postgresql://user:pass@localhost/db
SECRET_KEY=my-super-secret-value
NODE_ENV=production`;
    const result = redact(input);

    expect(result).not.toContain('postgresql://user:pass@localhost/db');
    expect(result).not.toContain('my-super-secret-value');
    expect(result).toContain('DATABASE_URL=[REDACTED:env_value]');
    expect(result).toContain('SECRET_KEY=[REDACTED:env_value]');
    expect(result).toContain('NODE_ENV=[REDACTED:env_value]');
  });
});

describe('Secret Redaction — High-Entropy Strings', () => {
  it('detects long base64-like strings', () => {
    const input =
      'const token = "aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgYmFzZTY0IHN0cmluZyB0aGF0IHNob3VsZCBiZSByZWRhY3RlZA==";';
    const result = redact(input);

    expect(result).toContain('[REDACTED:high_entropy]');
  });
});

describe('Secret Redaction — Diff Output', () => {
  it('redacts secrets in both old and new sides of diff', () => {
    const diff = `- const DB = "postgresql://user:oldpass123@db.old.com/prod";
+ const DB = "postgresql://user:newpass456@db.new.com/prod";
  const PORT = 3000;`;

    const result = redactDiff(diff);

    expect(result).not.toContain('oldpass123');
    expect(result).not.toContain('newpass456');
    expect(result).toContain('[REDACTED]');
    expect(result).toContain('const PORT = 3000');
  });
});

describe('Secret Redaction — Non-Secret Content', () => {
  it('does not redact normal code', () => {
    const input = `import express from 'express';
const app = express();
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(3000);`;

    const result = redact(input);
    expect(result).toBe(input); // unchanged
  });

  it('does not redact short strings', () => {
    const input = 'const name = "hello";';
    const result = redact(input);
    expect(result).toBe(input);
  });
});

describe('Secret Redaction — Custom Patterns', () => {
  it('supports custom redaction rules', () => {
    const customRule: RedactionRule = {
      name: 'stripe_key',
      pattern: /sk_(?:live|test)_[a-zA-Z0-9]{24,}/g,
      replacement: '[REDACTED:stripe_key]',
    };

    const fakeKey = 'sk_' + 'live' + '_' + 'a1b2c3d4e5f6g7h8i9j0k1l2m3';
    const input = `const stripe = require("stripe")("${fakeKey}");`;
    const result = redact(input, [customRule]);

    expect(result).not.toContain(fakeKey);
    expect(result).toContain('[REDACTED:stripe_key]');
  });
});
