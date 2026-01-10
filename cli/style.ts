import { Ansi } from './tokens';

export function blue(text: string): string {
  return `${Ansi.Blue}${text}${Ansi.Reset}`;
}

export function bold(text: string): string {
  return `${Ansi.Bold}${text}${Ansi.Reset}`;
}

export function dim(text: string): string {
  return `${Ansi.Dim}${text}${Ansi.Reset}`;
}

export function gray(text: string): string {
  return `${Ansi.Gray}${text}${Ansi.Reset}`;
}

export function green(text: string): string {
  return `${Ansi.Green}${text}${Ansi.Reset}`;
}

export function orange(text: string): string {
  return `${Ansi.Orange}${text}${Ansi.Reset}`;
}

export function red(text: string): string {
  return `${Ansi.Red}${text}${Ansi.Reset}`;
}

export function yellow(text: string): string {
  return `${Ansi.Yellow}${text}${Ansi.Reset}`;
}
