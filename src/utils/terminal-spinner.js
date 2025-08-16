import chalk from 'chalk';

const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

export class Spinner {
  constructor(text = '') {
    this.text = text;
    this.frameIndex = 0;
    this.timer = null;
    this.active = false;
    this.isTTY = process.stdout.isTTY;
  }

  render() {
    if (!this.isTTY) return;
    const frame = frames[this.frameIndex = (this.frameIndex + 1) % frames.length];
    const line = `${chalk.cyan(frame)} ${chalk.dim(this.text)}`;
    process.stdout.write(`\r${line}`);
  }

  start(text) {
    if (text) this.text = text;
    if (!this.isTTY) {
      if (this.text) console.log(`${chalk.cyan('…')} ${this.text}`);
      this.active = true;
      return this;
    }
    if (this.timer) clearInterval(this.timer);
    this.active = true;
    this.timer = setInterval(() => this.render(), 80);
    return this;
  }

  update(text) {
    this.text = text || this.text;
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.isTTY) process.stdout.write('\r');
    this.active = false;
    return this;
  }

  succeed(text) {
    this.stop();
    const msg = text || this.text;
    console.log(`${chalk.green('✔')} ${msg}`);
    return this;
  }

  fail(text) {
    this.stop();
    const msg = text || this.text;
    console.log(`${chalk.red('✖')} ${msg}`);
    return this;
  }
}

export function createSpinner(text) {
  return new Spinner(text);
}
