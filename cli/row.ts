import { formatTime } from './format';
import { bold, dim, green, red } from './style';
import { Layout, Symbol } from './tokens';

type RowOptions = {
  success?: boolean;
};

type SummaryOptions = {
  detail?: string;
  indent?: boolean;
  success?: boolean;
  time?: number;
};

export function detail(text: string): string {
  return `${Layout.Indent}${Layout.Indent}${dim(text)}`;
}

export function failureSummary(passed: number, failed: number): string {
  return `\n${Layout.Indent}${red(Symbol.Cross)} ${passed} passed, ${failed} failed\n`;
}

export function header(name: string, meta?: string): string {
  const metaPart = meta ? ` ${dim(meta)}` : '';
  return `${bold(name)}${metaPart}\n`;
}

export function info(text: string): string {
  return `${Layout.Indent}${dim(text)}`;
}

export function row(name: string, options?: RowOptions): string {
  const success = options?.success ?? true;
  const symbol = success ? green(Symbol.Check) : red(Symbol.Cross);
  return `${Layout.Indent}${symbol} ${name}`;
}

export function summary(name: string, options?: SummaryOptions): string {
  const success = options?.success ?? true;
  const time = options?.time;
  const detail = options?.detail;
  const shouldIndent = options?.indent ?? success;

  const color = success ? green : red;
  const symbol = success ? Symbol.Check : Symbol.Cross;
  const leading = shouldIndent ? '\n' : '';
  const indent = shouldIndent ? Layout.Indent : '';
  const hasTime = time !== undefined;
  const paddedName = hasTime ? name.padEnd(Layout.NameWidth) : name;

  let content = `${indent}${color(`${symbol} ${paddedName}`)}`;
  if (hasTime) content += ` ${dim(formatTime(time))}`;
  if (detail) content += ` ${dim(`${Symbol.Bullet} ${detail}`)}`;

  return `${leading}${content}\n\n`;
}

export function timedRow(name: string, time: number, detail?: string): string {
  const paddedName = name.padEnd(Layout.NameWidth);
  const timePart = dim(formatTime(time));
  const detailPart = detail ? `   ${dim(detail)}` : '';
  return `${Layout.Indent}${green(Symbol.Check)} ${paddedName} ${timePart}${detailPart}`;
}
