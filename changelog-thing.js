#!/usr/bin/env node

const cp = require('child_process')
const fs = require('fs')
const path = require('path')

const DEFAULT_CONFIG_FILE = `${process.env.HOME}/.config/changelog-thing.config.json`
const FMT = '%an|%d|%s|%cr|%H'
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
  parts = line.split('|')
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
  const gitCmd = `git --git-dir=${dir}/.git`
  runCmd(`${gitCmd} rev-parse --is-inside-work-tree &>/dev/null`, EXIT.GIT)
  const url = runCmd(`${gitCmd} config --get remote.${args.remote}.url`, EXIT.GIT)
    .replace(/(ssh:\/\/)?[^@]*@([^:]*)(:[0-9]*\/|:)(.*)$/, "https://$2/$4")
  const repoName = capitalizeEachWord(url.replace(/.*\/([^\.]*).*$/, '$1'))
  const commits = sortCommitsByType(
    args.types,
    runCmd(`${gitCmd} log --since='${args.age} days ago' --pretty=format:'${FMT}'`)
      .split('\n')
      .filter(l => filterLinesByPatterns(l, regexes))
      .map(l => parseLine(l, args.ignoreErrors))
  )
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
    ).replaceAll('\n', '') + '\n'
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
  fs.mkdirSync(path.dirname(fn), { recursive: true })
  fs.writeFileSync(fn, JSON.stringify(args, null, 2))
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

const convertMdFileToHtml = args => {
  const fn = changeExtension(args.output, 'html')
  require('@bodneyc/mdtohtml')({
    input: args.output,
    output: fn,
    beautify: args.beautify,
    external: true,
  })
  return fn
}

// ------------------ Entrypoint(s)

const showHelp = _ => {
  const { red, green, yellow, blue, italic, grey } = require('kleur')
  console.log(`
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

    ${yellow('-h')}${blue('|')}${yellow('--help')}                 Show this help section
    ${yellow('-d')}${blue('|')}${yellow('--dir')}                  Given for each repo directory
    ${yellow('-a')}${blue('|')}${yellow('--age')}                  Look for commits from ${italic('n')} days ago
    ${yellow('-i')}${blue('|')}${yellow('--input')}                Input file previously generated by this program
    ${yellow('--infrm')}${blue('|')}${yellow('--inform')}          Format of --input
    ${yellow('-o')}${blue('|')}${yellow('--output')}               Specify output filename
    ${yellow('--outfrm')}${blue('|')}${yellow('--outform')}        Format of --output
    ${yellow('-b')}${blue('|')}${yellow('--beautify')}             Beautify HTML (boolean)
    ${yellow('-r')}${blue('|')}${yellow('--remote')}               Name of remote (default 'origin')
    ${yellow('-c')}${blue('|')}${yellow('--config')}               Configuration file (can be generated with -w)
    ${yellow('-s')}${blue('|')}${yellow('--summaries')}            Add summaries section to markdown (boolean)
    ${yellow('--ign')}${blue('|')}${yellow('--ignore-errors')}     Ignore invalid commit data (boolean)
    ${yellow('--html')}${blue('|')}${yellow('--write-html')}       Write HTML output (boolean)
    ${yellow('--json')}${blue('|')}${yellow('--write-json')}       Write JSON output (boolean)
    ${yellow('-t')}${blue('|')}${yellow('--doc-title')}            Title of document for multi-repo reports
    ${yellow('-l')}${blue('|')}${yellow('--long-commits')}         Longer commit output
    ${yellow('-p')}${blue('|')}${yellow('--filter-patterns')}      Regexes by which to filter (remove) commits
    ${yellow('-w')}${blue('|')}${yellow('--write-default-config')} Write config file to ${DEFAULT_CONFIG_FILE}

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

  `)
  process.exit(0)
}

const processArgs = args => {
  if (args.help) showHelp(args)
  return {
    dirs: (dirs => {
      if (typeof dirs == 'string') dirs = [dirs]
      return dirs
    })(args.dir || ['.']),
    ignoreErrors: args['ignore-errors'],
    docTitle: args['doc-title'] || 'Organization Name',
    age: args.age || 14,
    inform: args.inform ? findIoForm(args.inform) : null,
    input: args.input ? path.join(process.cwd(), args.input) : null,
    outform: args.outform ? findIoForm(args.outform) : IO_FORMS.MD,
    output: path.join(process.cwd(), args.output || 'out.md'),
    beautify: args.beautify || true,
    remote: args.remote || 'origin',
    filterPatterns: (fp => {
      if (typeof fp == 'string') fp = [fp]
      return fp.map(p => new RegExp(p))
    })(args['filter-patterns'] || []),
    config: args.config,
    commitHashLength: 7,
    summaries: args.summaries,
    writeHtml: args['write-html'],
    writeJson: args['write-json'],
    compactCommits: !args['long-commits'],
    types: {
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

const mergeWithConfigFile = args => {
  if (!args.config)
    return args
  try {
    return {
      ...args,
      ...require(args.config)
    }
  } catch (e) {
    msg(`Invalid config: ${e}`, EXIT.OPT)
  }
}

const main = _args => {
  const args = mergeWithConfigFile(processArgs(_args))
  if (_args['write-default-config']) writeDefaultConfig(args)

  var reposInfo
  if (args.inform && args.inform == IO_FORMS.JSON)
    reposInfo = JSON.parse(fs.readFileSync(args.input))
  else
    reposInfo = processRepos(args, args.filterPatterns)

  if (args.outform == IO_FORMS.JSON || args.writeJson) {
    const outFn = writeReposAsJson(args.output, reposInfo, false)
    msg(`JSON written to ${outFn}`,
      (args.outform != IO_FORMS.JSON && args.writeJson) ? null : EXIT.SUC)
  }

  const outMdFn = writeMdReport(args.output, reposToMd(reposInfo, args))
  if (args.outform == IO_FORMS.MD)
    msg(`MD written to ${outMdFn}`, args.writeHtml ? null : EXIT.SUC)

  if (args.outform == IO_FORMS.HTML || args.writeHtml) {
    const outFn = convertMdFileToHtml(args)
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
