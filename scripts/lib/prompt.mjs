// Terminal prompts for the release script. `askHidden` reads in raw mode and echoes nothing
// at all — not the characters, not a redraw of the line — so a secret never appears on
// screen, in scrollback or in anything that reads the terminal.

/** A visible line of input. */
export function ask(question) {
  return readRaw(question, true);
}

/** A line of input that is never shown. */
export function askHidden(question) {
  return readRaw(question, false);
}

function readRaw(question, echo) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('needs a terminal'));
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    let escape = false; // inside an escape sequence (arrow keys etc.): ignore it
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (escape) {
          if (/[A-Za-z~]/.test(ch)) escape = false;
          continue;
        }
        if (ch === '\u001b') {
          escape = true;
          continue;
        }
        if (ch === '\r' || ch === '\n') {
          done();
          return resolve(value.trim());
        }
        if (ch === '\u0003') {
          // Ctrl+C
          done();
          return process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value && echo) stdout.write('\b \b');
          value = value.slice(0, -1);
        } else if (ch >= ' ') {
          value += ch;
          if (echo) stdout.write(ch);
        }
      }
    };
    stdin.on('data', onData);
  });
}
