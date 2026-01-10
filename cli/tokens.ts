export enum Ansi {
  Blue = '\x1b[34m',
  Bold = '\x1b[1m',
  Dim = '\x1b[2m',
  Gray = '\x1b[38;5;245m',
  Green = '\x1b[32m',
  Orange = '\x1b[38;5;208m',
  Red = '\x1b[31m',
  Reset = '\x1b[0m',
  Yellow = '\x1b[33m',
}

export enum Symbol {
  Bullet = '·',
  Check = '✓',
  Cross = '✗',
  Info = 'ℹ',
  Warn = '⚠',
}

export const Layout = {
  Indent: '  ',
  NameWidth: 8,
} as const;
