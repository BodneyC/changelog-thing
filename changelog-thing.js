#!/usr/bin/env node

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_FILE = `${process.env.HOME}/.config/changelog-thing.config.json`;
const DELIM = '::@::';
const FMT = `%an${DELIM}%d${DELIM}%s${DELIM}%cr${DELIM}%H`;
const PARTS = (FMT.match(/%/g) || []).length;
const IO_FORMS = {
  MD: ['md', 'markdown'],
  HTML: ['html'],
};
const EXIT = {
  SUC: 0,
  OPT: 1,
  SYS: 2,
  GIT: 3,
  UNK: 4,
};

// ------------------ Helpers

const findIoForm = str => {
  const form = Object.keys(IO_FORMS).find(k => IO_FORMS[k].includes(str.toLowerCase()));
  if (!form) {
    msg(`${str} is an invalid IO format`, EXIT.OPT);
  }
  return IO_FORMS[form];
};

const msg = (msg, status) => {
  console.error(msg);
  if (status != null) {
    process.exit(status);
  }
};

const runCmd = (cmd, exit = EXIT.SYS) => {
  try {
    return cp.execSync(cmd).toString().trim();
  } catch (e) {
    msg(e.message, exit);
  }
};

// ------------------ String/MD helpers

const getSummarySection = level => stripIndent(`\
    ${repeatChar(level)} Summary

    {{Please fill in this summary}}

    `);

const capitalizeEachWord = str => {
  if (!str) {
    return '';
  }
  return str.replace(/(^\w{1})|([\s-_]{1}\w{1})/g, l => l.toUpperCase());
};

const repeatChar = (count, char = '#') => char.repeat(count);

const stripIndent = str => {
  const match = str.match(/^[ \t]*(?=\S)/gm);
  if (!match) {
    return str;
  }
  const idx = match.reduce((r, a) => Math.min(r, a.length), Infinity);
  return str.replace(new RegExp(`^[ \t]{${idx}}`, 'gm'), '');
};

const shaWithUrlMd = (url, sha, commitHashLength) =>
  `[${sha.substring(0, commitHashLength)}](${url.replace(/\.git$/, '')}/commit/${sha})`;

// ------------------ Parse from Git

const parseLine = (line, ignoreErrors) => {
  let parts = line.split(DELIM);
  if (parts.length != PARTS) {
    msg(`Invalid line: ${line}`, ignoreErrors ? EXIT.GIT : null);
  }
  let message = parts[2];
  let msgSplit = message.split(':', 2);
  let type = {
    title: 'misc',
    subtitle: null
  };
  if (msgSplit.length == 2) {
    message = msgSplit[1].trim();
    // eslint-disable-next-line no-useless-escape
    let typeInfo = msgSplit[0].match(/^([^\(]*)(\(([^\)]*)\))?/);
    type = {
      title: typeInfo[1],
      subtitle: typeInfo[3],
    };
  }
  return {
    author: parts[0],
    branches: parts[1],
    message: message,
    age: parts[3],
    sha: parts[4],
    type: type,
  };
};

const filterLinesByPatterns = (line, regexes) => {
  for (let i = 0; i < regexes.length; i++) {
    if (regexes[i].test(line)) {
      return false;
    }
  }
  return true;
};

const sortCommitsByType = (types, commits) => {
  let sorted = {};
  for (let [short, long] of Object.entries(types)) {
    commits.filter(c => c.type.title == short)
      .forEach(c => {
        if (!(long in sorted)) {
          sorted[long] = [];
        }
        sorted[long].push(c);
      });
  }
  return sorted;
};

const processRepo = (dir, args, regexes) => {
  msg(`Processing directory: ${dir}`);
  const gitCmd = `git --git-dir=${dir}/.git`;
  runCmd(`${gitCmd} rev-parse --is-inside-work-tree &>/dev/null`, EXIT.GIT);
  const url = runCmd(`${gitCmd} config --get remote.${args.remote}.url`, EXIT.GIT)
    .replace(/(ssh:\/\/)?[^@]*@([^:]*)(:[0-9]*\/|:)(.*)$/, 'https://$2/$4');
  // eslint-disable-next-line no-useless-escape
  const repoName = capitalizeEachWord(url.replace(/.*\/([^\.]*).*$/, '$1'));
  const gitLog = runCmd(
    `${gitCmd} log --since='${args.age} days ago' --pretty=format:'${FMT}'`
  ).split('\n');
  msg(`  ${gitLog.length} commits found`);
  let commits = gitLog
    .filter(l => l !== '' && filterLinesByPatterns(l, regexes))
    .map(l => parseLine(l, args.ignoreErrors));
  if (gitLog.length !== commits.length) {
    msg(`  ${gitLog.length - commits.length} commits filtered`);
  }
  commits = sortCommitsByType(args.types, commits);
  return {
    url: url,
    repo: repoName,
    commits: commits,
  };
};

// ------------------ Form markdown

const commitToMd = (url, commit, args) => {
  if (args.compactCommits) {
    const subtitle = (commit.type.subtitle) ?
      `__${capitalizeEachWord(commit.type.subtitle)}__: ` : '';
    return stripIndent(`\
      - ${subtitle}${commit.message}. ${commit.author}, ${commit.age}
       (${shaWithUrlMd(url, commit.sha, args.commitHashLength)})`
    ).replace(/[\n\r]/g, '') + '\n';
  } else {
    return stripIndent(`\
      &emsp;__Area__: ${capitalizeEachWord(commit.type.subtitle) || 'General'}</br>
      &emsp;__Message__: ${commit.message}</br>
      &emsp;__Branches Affected__: ${commit.branches || 'N/a'}</br>
      &emsp;__Author__: ${commit.author}</br>
      &emsp;__Committed__: ${commit.age}</br>
      &emsp;__Commit SHA__: ${shaWithUrlMd(url, commit.sha, args.commitHashLength)}
      `) + '\n';
  }
};


const repoToMd = (repo, args, level = 1) => {
  let md = stripIndent(`\
    ${repeatChar(level)} Project: ${repo.repo}

    [Link to the repo](${repo.url})

    `);
  if (args.summaries) {
    md += getSummarySection(level + 1);
  }
  md += stripIndent(`\
    ${repeatChar(level + 1)} Commits
    `);
  for (let [type, commits] of Object.entries(repo.commits)) {
    md += stripIndent(`
      ${repeatChar(level + 2)} ${type}

      `);
    for (let commit of commits) {
      md += commitToMd(repo.url, commit, args);
    }
  }
  return md;
};

const reposToMd = (reposInfo, args) => {
  let md = '';
  let level = 1;
  if (reposInfo.repos.length > 1) {
    md = `${repeatChar(level)} ${reposInfo.docTitle}\n\n`;
    if (args.summaries) {
      md += getSummarySection(level + 1);
    }
    level = 2;
  }
  for (let repo of reposInfo.repos) {
    md += repoToMd(repo, args, level) + '\n';
  }
  return md;
};

// ------------------ IO

const writeDefaultConfig = args => {
  const fn = args.config || DEFAULT_CONFIG_FILE;
  // I realise this isn't particularly maintainable
  const filterKeys = ['dirs', 'output', 'outform', 'input'];
  const argsFiltered = {};
  Object.keys(args)
    .filter(k => !filterKeys.includes(k))
    .forEach(k => argsFiltered[k] = args[k]);
  fs.mkdirSync(path.dirname(fn), { recursive: true });
  fs.writeFileSync(fn, JSON.stringify(argsFiltered, null, 2));
  msg(`Default config written to: ${fn}`, EXIT.SUC);
};

const convertMdFileToHtml = (output, beautify, mdFn) => {
  require('@bodneyc/mdtohtml')({
    output,
    beautify,
    input: mdFn,
    external: true,
  });
};

// ------------------ Entrypoint(s)

const showHelpAndExit = () => {
  const { red, green, yellow, blue, italic, grey } = require('kleur');
  msg(`
${green('Changelog Thing')}

    A multi-repo changelog generator using commits since a specific date

${green('Usage')}:

    ${yellow('changelog-thing')} \
${blue('[')}${yellow('--age')} ${red('<')}${yellow('age-in-days')}${red('>')}${blue(']')} \
${blue('[')}${yellow('--outform')} ${red('<')}${yellow('html')}${red('>')}${blue(']')} \\
        ${blue('[')}${yellow('--output')} ${red('<')}${yellow('output')}${red('>')}${blue(']')} \
${blue('[')}${yellow('--beautify')}${blue(']')} \
${blue('[')}${yellow('--summaries')}${blue(']')} \\
        ${blue('[')}${red('<')}${yellow('./my-repo')}${red('>')} ${grey('...')}'${blue(']')} \

${green('Options')}:

    ${yellow('-h')}${blue('|')}${yellow('--help')}                   Show this help section
    ${yellow('-a')}${blue('|')}${yellow('--age')}                    Look for commits from ${italic('n')} days ago
    ${yellow('-i')}${blue('|')}${yellow('--input')}                  Input file previously generated by this program
    ${yellow('-o')}${blue('|')}${yellow('--output')}                 Specify output filename
    ${yellow('--outfrm')}${blue('|')}${yellow('--outform')}          Format of --output
    ${yellow('-b')}${blue('|')}${yellow('--beautify')}               Beautify HTML (boolean)
    ${yellow('-r')}${blue('|')}${yellow('--remote')}                 Name of remote (default 'origin')
    ${yellow('-c')}${blue('|')}${yellow('--config')}                 Configuration file (can be generated with -w)
    ${yellow('-s')}${blue('|')}${yellow('--summaries')}              Add summaries section to markdown (boolean)
    ${yellow('--dc')}${blue('|')}${yellow('--default-config')}       Use the default config
    ${yellow('--chr')}${blue('|')}${yellow('--commit-hash-length')}  Sets the commit hash length
    ${yellow('--ign')}${blue('|')}${yellow('--ignore-errors')}       Ignore invalid commit data (boolean)
    ${yellow('-t')}${blue('|')}${yellow('--doc-title')}              Title of document for multi-repo reports
    ${yellow('-l')}${blue('|')}${yellow('--long-commits')}           Longer commit output
    ${yellow('-p')}${blue('|')}${yellow('--filter-patterns')}        Regexes by which to filter (remove) commits
    ${yellow('-w')}${blue('|')}${yellow('--write-default-config')}   Write config file to ${DEFAULT_CONFIG_FILE}

${green('Examples')}:

Generate a report in markdown with placeholders for summaries, then convert
  that MD to an HTML report

    ${yellow(`$ changelog-thing \\
        --age 14 --summaries --title "My big ol report" --outform md \\
        ./project-1 ./project-2 ./project-3`)}
    ${green('MD written to $PWD/out.md')}

    ${grey(`# Edit 'out.md' and add some nice summaries
    # Now, convert the updated MD to HTML`)}

    ${yellow('$ changelog-thing --md-to-html out.md')}
    ${green('HTML written to $PWD/out.html')}

  `, EXIT.SUC);
};

const processArgs = (args, conf) => {
  if (args.help) {
    showHelpAndExit(args);
  }

  let config = args.config;
  if (args['default-config']) {
    config = DEFAULT_CONFIG_FILE;
  }

  const strToArr = v => typeof (v) === 'string' ? [v] : v;
  const checkFields = (argsField, confField, defaultValue) =>
    args[argsField] || conf[confField] || defaultValue;

  const mdToHtml = args['md-to-html'] ? path.join(process.cwd(), args['md-to-html']) : null;

  const outform = args.outform ? findIoForm(args.outform) : IO_FORMS.HTML;
  let output = args.output || 'out.' + outform[0];

  return {
    config,

    dirs: strToArr(args._ || conf.dir || ['.']),

    mdToHtml,
    outform,
    output,

    filterPatterns: strToArr(args['filter-patterns'] || conf.filterPatterns || []),
    commitHashLength: checkFields('commit-hash-length', 'commitHashLength', 7),
    ignoreErrors: checkFields('ignore-errors', 'ignoreErrors', false),
    docTitle: checkFields('doc-title', 'docTitle', 'Organization Name'),
    age: checkFields('age', 'age', 14),
    beautify: checkFields('beautify', 'beautify', false),
    remote: checkFields('remote', 'remote', 'origin'),
    summaries: checkFields('summaries', 'summaries', false),
    compactCommits: !args['long-commits'] || conf.compactCommits,

    types: conf.types || {
      feat: 'Features',
      fix: 'Fixes',
      perf: 'Performance Improvements',
      revert: 'Reversions',
      docs: 'Documentation',
      style: 'Styles',
      refactor: 'Refactoring',
      test: 'Testing',
      chore: 'Chores',
      misc: 'Misc.',
      ci: 'Pipeline Changes',
    },
  };
};

const readConfigFile = args => {
  if (args['default-config']) {
    args.config = DEFAULT_CONFIG_FILE;
  }
  if (args.config) {
    try {
      return require(args.config);
    } catch (e) {
      msg(`Invalid config: ${e}`, EXIT.OPT);
    }
  }
  return {};
};

const main = _args => {
  const args = processArgs(_args, readConfigFile(_args));
  if (_args['write-default-config']) {
    writeDefaultConfig(args);
  }

  if (args.dirs.length) {
    const reposInfo = {
      docTitle: args.docTitle,
      repos: args.dirs
        .map(d => processRepo(d, args, args.filterPatterns.map(p => new RegExp(p))))
        .filter(d => Object.keys(d.commits).length)
    };

    if (reposInfo.repos.length === 0) {
      msg('No commits found in any provided repo', EXIT.OPT);
    }

    const mdString = reposToMd(reposInfo, args);

    if (args.outform === IO_FORMS.MD) {
      fs.writeFileSync(args.output, mdString);
      msg(`MD written to ${args.output}`, EXIT.SUC);

    } else {
      const tmpobj = require('tmp').fileSync();
      fs.writeFileSync(tmpobj.name, mdString);
      convertMdFileToHtml(args.output, args.beautify, tmpobj.name);
      tmpobj.removeCallback();
      msg(`HTML written to ${args.output}`, EXIT.SUC);
    }
  } else if (args.mdToHtml) {
    convertMdFileToHtml(args.output, args.beautify, args.mdToHtml);
    msg(`HTML written to ${args.output}`);
  }

};

if (require.main === module) {
  main(require('minimist')(process.argv.slice(2), {
    alias: {
      help: 'h',
      age: 'a',
      'md-to-html': ['md'],
      output: ['o', 'out'],
      outform: 'ofrm',
      beautify: 'b',
      remote: 'r',
      config: 'c',
      summaries: 's',
      'default-config': 'dc',
      'commit-hash-length': 'chl',
      'ignore-errors': 'ign',
      'doc-title': ['t', 'title'],
      'long-commits': 'l',
      'filter-patterns': 'p',
      'write-default-config': 'w',
    }
  }));
}

module.exports = main;
