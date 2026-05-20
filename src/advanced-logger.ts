import chalk from 'chalk';
import boxen from 'boxen';
import ora from 'ora';
import { logger } from './logger.js';

export interface TaskSpinner {
  succeed(msg?: string): void;
  fail(msg?: string): void;
  warn(msg?: string): void;
  info(msg?: string): void;
  text: string;
}

class AdvancedLogger {
  private static instance: AdvancedLogger;

  static getInstance(): AdvancedLogger {
    if (!AdvancedLogger.instance) {
      AdvancedLogger.instance = new AdvancedLogger();
    }
    return AdvancedLogger.instance;
  }

  private constructor() {}

  task(msg: string): TaskSpinner {
    const spinner = ora({ text: chalk.cyan(msg), spinner: 'dots', color: 'cyan' }).start();
    let done = false;

    logger.info('[Task] ' + msg, { status: 'start' });

    return {
      get text() { return msg; },
      set text(v: string) { msg = v; spinner.text = chalk.cyan(v); },
      succeed(m?: string) {
        if (done) return;
        done = true;
        spinner.succeed(chalk.green(m || msg));
        logger.info('[Task] ' + (m || msg), { status: 'success' });
      },
      fail(m?: string) {
        if (done) return;
        done = true;
        spinner.fail(chalk.red(m || msg));
        logger.error('[Task] ' + (m || msg), { status: 'fail' });
      },
      warn(m?: string) {
        if (done) return;
        done = true;
        spinner.warn(chalk.yellow(m || msg));
        logger.warn('[Task] ' + (m || msg), { status: 'warn' });
      },
      info(m?: string) {
        if (done) return;
        done = true;
        spinner.info(chalk.cyan(m || msg));
        logger.info('[Task] ' + (m || msg), { status: 'info' });
      },
    };
  }

  success(msg: string, meta?: Record<string, unknown>) {
    console.log(`${chalk.green('✔')} ${chalk.green(msg)}`);
    logger.info(msg, meta);
  }

  decision(title: string, content: string) {
    const boxed = boxen(
      `${chalk.bold(chalk.yellow(title))}\n\n${content}`,
      { padding: { top: 0, bottom: 1, left: 1, right: 1 }, borderColor: 'yellow', borderStyle: 'round', title: '⚡ DECISION' }
    );
    console.log(`\n${boxed}\n`);
    logger.info('[Decision] ' + title, { title, content: content.slice(0, 500) });
  }

  info(msg: string, meta?: Record<string, unknown>) {
    logger.info(msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>) {
    logger.warn(msg, meta);
  }

  error(msg: string, meta?: Record<string, unknown>) {
    logger.error(msg, meta);
  }
}

const instance = AdvancedLogger.getInstance();

export default instance;
export { AdvancedLogger };
