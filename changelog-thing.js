#!/usr/bin/env node

const cp = require('child_process')
const fs = require('fs')
const path = require('path')

const DEFAULT_CONFIG_FILE = `${process.env.HOME}/.config/changelog-thing.config.json`
const DELIM = '::@::'
const FMT = `%an${DELIM}%d${DELIM}%s${DELIM}%cr${DELIM}%H`
const PARTS = (FMT.match(/%/g) || []).length
const IO_FORMS = {
  MD: ['md', 'markdown'],
  JSON: ['json'],
  HTML: ['html'],
}
const EXIT = {
  SUC: 0,
  OPT: 1,
  SYS: 2,
  GIT: 3,
  UNK: 4,
}

// ------------------ Helpers

const findIoForm = str => {
  const form = Object.keys(IO_FORMS).find(k => IO_FORMS[k].includes(str.toLowerCase()))
  if (!form) msg(`${str} is an invalid IO format`, EXIT.OPT)
  return IO_FORMS[form]
}

const msg = (msg, status) => {
  console.error(msg)
  if (status != null)
    process.exit(status)
}

const runCmd = (cmd, exit = EXIT.SYS) => {
  try {
    return cp.execSync(cmd).toString().trim()
  } catch (e) {
    msg(e.message, exit)
  }
}

// ------------------ String/MD helpers

const changeExtension = (str, ext) => `${str.replace(/\.(md|MD)$/, '')}.${ext}`

const getSummarySection = level => stripIndent(`\
    ${repeatChar(level)} Summary

    {{Please fill in this summary}}

    `)

const capitalizeEachWord = str => {
  if (!str) return ''
  return str.replace(/(^\w{1})|([\s-_]{1}\w{1})/g, l => l.toUpperCase());
}

const repeatChar = (count, char = '#') => char.repeat(count)

const stripIndent = str => {
  const match = str.match(/^[ \t]*(?=\S)/gm)
  if (!match) return str
  const ind = match.reduce((r, a) => Math.min(r, a.length), Infinity)
  return str.replace(new RegExp(`^[ \t]{${ind}}`, 'gm'), '')
}

const shaWithUrlMd = (url, sha, commitHashLength) =>
  `[${sha.substring(0, commitHashLength)}](${url.replace(/\.git$/, '')}/commit/${sha})`

// ------------------ Parse from Git

const parseLine = (line, ignoreErrors) => {
  parts = line.split(DELIM)
  if (parts.length != PARTS)
    msg(`Invalid line: ${line}`, ignoreErrors ? EXIT.GIT : null)
  var message = parts[2]
  var msgSplit = message.split(':', 2)
  var type = {
    title: 'misc',
    subtitle: null
  }
  if (msgSplit.length == 2) {
    message = msgSplit[1].trim()
    typeInfo = msgSplit[0].match(/^([^\(]*)(\(([^\)]*)\))?/)
    type = {
      title: typeInfo[1],
      subtitle: typeInfo[3],
    }
  }
  return {
    author: parts[0],
    branches: parts[1],
    message: message,
    age: parts[3],
    sha: parts[4],
    type: type,
  }
}

const filterLinesByPatterns = (line, regexes) => {
  for (var i = 0; i < regexes.length; i++)
    if (regexes[i].test(line))
      return false
  return true
}

const sortCommitsByType = (types, commits) => {
  var sorted = {}
  for (var [short, long] of Object.entries(types)) {
    commits.filter(c => c.type.title == short)
      .forEach(c => {
        if (!sorted.hasOwnProperty(long)) sorted[long] = []
        sorted[long].push(c)
      })
  }
  return sorted
}

const processRepo = (dir, args, regexes) => {
  msg(`Processing directory: ${dir}`)
  const gitCmd = `git --git-dir=${dir}/.git`
  runCmd(`${gitCmd} rev-parse --is-inside-work-tree &>/dev/null`, EXIT.GIT)
  const url = runCmd(`${gitCmd} config --get remote.${args.remote}.url`, EXIT.GIT)
    .replace(/(ssh:\/\/)?[^@]*@([^:]*)(:[0-9]*\/|:)(.*)$/, "https://$2/$4")
  const repoName = capitalizeEachWord(url.replace(/.*\/([^\.]*).*$/, '$1'))
  const gitLog = runCmd(
    `${gitCmd} log --since='${args.age} days ago' --pretty=format:'${FMT}'`
  ).split('\n')
  msg(`  ${gitLog.length} commits found`)
  var commits = gitLog
    .filter(l => l !== '' && filterLinesByPatterns(l, regexes))
    .map(l => parseLine(l, args.ignoreErrors))
  if (gitLog.length !== commits.length)
    msg(`  ${gitLog.length - commits.length} commits filtered`)
  commits = sortCommitsByType(args.types, commits)
  return {
    url: url,
    repo: repoName,
    commits: commits,
  }
}

const processRepos = (args, regexes) => {
  var repos = []
  args.dirs.forEach(d => repos.push(processRepo(d, args, regexes)))
  return {
    docTitle: args.docTitle,
    repos: repos
  }
}

// ------------------ Form markdown

const commitToMd = (url, commit, args) => {
  if (args.compactCommits) {
    const subtitle = (commit.type.subtitle) ?
      `__${capitalizeEachWord(commit.type.subtitle)}__: ` : ''
    return stripIndent(`\
      - ${subtitle}${commit.message}. ${commit.author}, ${commit.age}
       (${shaWithUrlMd(url, commit.sha, args.commitHashLength)})`
    ).replace(/[\n\r]/g, '') + '\n'
  } else {
    return stripIndent(`\
      &emsp;__Area__: ${capitalizeEachWord(commit.type.subtitle) || 'General'}</br>
      &emsp;__Message__: ${commit.message}</br>
      &emsp;__Branches Affected__: ${commit.branches || 'N/a'}</br>
      &emsp;__Author__: ${commit.author}</br>
      &emsp;__Committed__: ${commit.age}</br>
      &emsp;__Commit SHA__: ${shaWithUrlMd(url, commit.sha, args.commitHashLength)}
      `) + '\n'
  }
}


const repoToMd = (repo, args, level = 1) => {
  var md = stripIndent(`\
    ${repeatChar(level)} Project: ${repo.repo}

    [Link to the repo](${repo.url})

    `)
  if (args.summaries) md += getSummarySection(level + 1)
  md += stripIndent(`\
    ${repeatChar(level + 1)} Commits
    `)
  for (var [type, commits] of Object.entries(repo.commits)) {
    md += stripIndent(`
      ${repeatChar(level + 2)} ${type}

      `)
    for (var commit of commits)
      md += commitToMd(repo.url, commit, args)
  }
  return md
}

const reposToMd = (reposInfo, args) => {
  var md = ''
  var level = 1
  if (reposInfo.repos.length > 1) {
    md = `${repeatChar(level)} ${reposInfo.docTitle}\n\n`
    if (args.summaries) md += getSummarySection(level + 1)
    level = 2
  }
  for (repo of reposInfo.repos)
    md += repoToMd(repo, args, level) + '\n'
  return md
}

// ------------------ IO

const writeDefaultConfig = args => {
  const fn = args.config || DEFAULT_CONFIG_FILE
  // I realise this isn't particularly maintainable
  const filterKeys = ['dirs', 'output', 'outform', 'input', 'inform']
  const argsFiltered = {}
  Object.keys(args)
    .filter(k => !filterKeys.includes(k))
    .forEach(k => argsFiltered[k] = args[k])
  fs.mkdirSync(path.dirname(fn), { recursive: true })
  fs.writeFileSync(fn, JSON.stringify(argsFiltered, null, 2))
  msg(`Default config written to: ${fn}`, EXIT.SUC)
}

const writeReposAsJson = (output, reposInfo) => {
  const fn = changeExtension(output, 'json')
  fs.writeFileSync(fn, JSON.stringify(reposInfo, null, 2))
  return fn
}

const writeMdReport = (output, md) => {
  const fn = changeExtension(output, 'md')
  fs.writeFileSync(fn, md)
  return fn
}

const convertMdFileToHtml = (args, mdFn) => {
  const fn = changeExtension(args.output, 'html')
  require('@bodneyc/mdtohtml')({
    input: mdFn,
    output: fn,
    beautify: args.beautify,
    external: true,
  })
  return fn
}

// ------------------ Entrypoint(s)

const showHelp = _ => {
  const { red, green, yellow, blue, italic, grey } = require('kleur')
  msg(`
${green('Changelog Thing')}

    A multi-repo changelog generator using commits since a specific date

${green('Usage')}:

    ${yellow('changelog-thing')} \
${blue('[')}${yellow('--dir')} ${red('<')}${yellow('./my-repo')}${red('>')}${blue(']')} \
${blue('[')}${yellow('--age')} ${red('<')}${yellow('age-in-days')}${red('>')}${blue(']')} \
${blue('[')}${yellow('--outform')} ${red('<')}${yellow('html')}${red('>')}${blue(']')} \\
        ${blue('[')}${yellow('--output')} ${red('<')}${yellow('output')}${red('>')}${blue(']')} \
${blue('[')}${yellow('--beautify')}${blue(']')} \
${blue('[')}${yellow('--summaries')}${blue(']')}

${green('Options')}:

    ${yellow('-h')}${blue('|')}${yellow('--help')}                   Show this help section
    ${yellow('-d')}${blue('|')}${yellow('--dir')}                    Given for each repo directory
    ${yellow('-a')}${blue('|')}${yellow('--age')}                    Look for commits from ${italic('n')} days ago
    ${yellow('-i')}${blue('|')}${yellow('--input')}                  Input file previously generated by this program
    ${yellow('--infrm')}${blue('|')}${yellow('--inform')}            Format of --input
    ${yellow('-o')}${blue('|')}${yellow('--output')}                 Specify output filename
    ${yellow('--outfrm')}${blue('|')}${yellow('--outform')}          Format of --output
    ${yellow('-b')}${blue('|')}${yellow('--beautify')}               Beautify HTML (boolean)
    ${yellow('-r')}${blue('|')}${yellow('--remote')}                 Name of remote (default 'origin')
    ${yellow('-c')}${blue('|')}${yellow('--config')}                 Configuration file (can be generated with -w)
    ${yellow('-s')}${blue('|')}${yellow('--summaries')}              Add summaries section to markdown (boolean)
    ${yellow('--dc')}${blue('|')}${yellow('--default-config')}       Use the default config
    ${yellow('--chr')}${blue('|')}${yellow('--commit-hash-length')}  Sets the commit hash length
    ${yellow('--ign')}${blue('|')}${yellow('--ignore-errors')}       Ignore invalid commit data (boolean)
    ${yellow('--html')}${blue('|')}${yellow('--write-html')}         Write HTML output (boolean)
    ${yellow('--json')}${blue('|')}${yellow('--write-json')}         Write JSON output (boolean)
    ${yellow('-t')}${blue('|')}${yellow('--doc-title')}              Title of document for multi-repo reports
    ${yellow('-l')}${blue('|')}${yellow('--long-commits')}           Longer commit output
    ${yellow('-p')}${blue('|')}${yellow('--filter-patterns')}        Regexes by which to filter (remove) commits
    ${yellow('-w')}${blue('|')}${yellow('--write-default-config')}   Write config file to ${DEFAULT_CONFIG_FILE}

${green('Examples')}:

Generate a report in markdown with placeholders for summaries, then convert
  that MD to an HTML report

    ${yellow(`$ changelog-thing \\
        -a 14 -d ./project-1 -d ./project-2 -d ./project-3 \\
        --summaries --title "My big ol report" --outform md`)}
    ${green(`MD written to $PWD/out.md`)}

    ${grey(`# Edit 'out.md' and add some nice summaries
    # Now, convert the updated MD to HTML`)}

    ${yellow(`$ changelog-thing --inform md --input out.md --outform html`)}
    ${green(`HTML written to $PWD/out.html`)}

  `, EXIT.SUC)
}

const processArgs = (args, conf) => {
  if (args.help) showHelp(args)
  return {
    dirs: (dirs => {
      if (typeof dirs == 'string') dirs = [dirs]
      return dirs
    })(args.dir || conf.dir || ['.']),

    inform: args.inform ? findIoForm(args.inform) : null,
    input: args.input ? path.join(process.cwd(), args.input) : null,
    outform: args.outform ? findIoForm(args.outform) : IO_FORMS.MD,
    output: path.join(process.cwd(), args.output || 'out.md'),

    config: ((c, dc) => {
      if (c) return c
      if (dc) return DEFAULT_CONFIG_FILE
    })(args.config, args['default-config']),

    filterPatterns: (fp => {
      if (typeof fp == 'string') fp = [fp]
      return fp
    })(args['filter-patterns'] || conf.filterPatterns || []),

    commitHashLength: args['commit-hash-length'] || conf.commitHashLength || 7,
    ignoreErrors: args['ignore-errors'] || conf.ignoreErrors || false,
    docTitle: args['doc-title'] || conf.docTitle || 'Organization Name',
    age: args.age || conf.age || 14,
    beautify: args.beautify || conf.beautify || false,
    remote: args.remote || conf.remote || 'origin',
    summaries: args.summaries || conf.summaries || false,
    writeHtml: args['write-html'] || conf.writeHtml || false,
    writeJson: args['write-json'] || conf.writeJson || false,
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
    },
  }
}

const readConfigFile = args => {
  if (args['default-config'])
    args.config = DEFAULT_CONFIG_FILE
  if (!args.config)
    return {}
  try {
    return require(args.config)
  } catch (e) {
    msg(`Invalid config: ${e}`, EXIT.OPT)
  }
}

const main = _args => {
  const args = processArgs(_args, readConfigFile(_args))
  if (_args['write-default-config']) writeDefaultConfig(args)

  var reposInfo = {}
  if (args.inform) {
    if (args.inform == IO_FORMS.JSON) {
      msg(`Reading JSON from ${args.inform}`)
      reposInfo = JSON.parse(fs.readFileSync(args.input))
    }
  } else {
    reposInfo = processRepos(args, args.filterPatterns.map(p => new RegExp(p)))
  }

  if (args.outform == IO_FORMS.JSON || args.writeJson) {
    const outFn = writeReposAsJson(args.output, reposInfo, false)
    msg(`JSON written to ${outFn}`,
      (args.outform != IO_FORMS.JSON && args.writeJson) ? null : EXIT.SUC)
  }

  var mdFn
  if (args.inform == IO_FORMS.MD) {
    mdFn = changeExtension(args.input, 'md')
    msg(`Using input markdown file: ${mdFn}`)
    args.outform = IO_FORMS.HTML
  } else {
    mdFn = writeMdReport(args.output, reposToMd(reposInfo, args))
  }
  if (args.outform == IO_FORMS.MD)
    msg(`MD written to ${mdFn}`, args.writeHtml ? null : EXIT.SUC)

  if (args.outform == IO_FORMS.HTML || args.writeHtml) {
    const outFn = convertMdFileToHtml(args, mdFn)
    msg(`HTML written to ${outFn}`)
  }
}

if (require.main === module)
  main(require('minimist')(process.argv.slice(2), {
    alias: {
      help: 'h',
      dir: 'd',
      age: 'a',
      input: ['i', 'in'],
      inform: 'ifrm',
      output: ['o', 'out'],
      outform: 'ofrm',
      beautify: 'b',
      remote: 'r',
      config: 'c',
      summaries: 's',
      'default-config': 'dc',
      'commit-hash-length': 'chl',
      'ignore-errors': 'ign',
      'write-html': 'html',
      'write-json': 'json',
      'doc-title': ['t', 'title'],
      'long-commits': 'l',
      'filter-patterns': 'p',
      'write-default-config': 'w',
    }
  }))

module.exports = main
