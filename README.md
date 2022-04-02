# Changelog Thing

Similar to [conventional-changelog-cli](https://www.npmjs.com/package/conventional-changelog-cli) but collecting commits from a particular number of days ago till now.

Some of the pipelines used at my place of work make unholy use of tags, this doesn't play too well with the package above which looks for the "previous release" based on the semver in a repo's tags.

This is a cobbled together solution which can generate one report for multiple projects since _n_ days ago (say, a sprint's worth, fourteen or so).

## Usage

| Option                      | Default             | Description                                                                     | Example               |
| ---                         | ---                 | ---                                                                             | ---                   |
| `help`, `h`                 | `false`             | Show cli help information                                                       | `-h`                  |
| `dir`, `d`                  | `['.']`             | Specify one or more directories to generate reports for                         | `-d repo-1 -d repo-2` |
| `age`, `a`                  | `14`                | Gather commits from _n_ days ago                                                | `-a 14`               |
| `md-to-html`, `md`          | `null`              | Markdown file to convert to HTML from previous run of the program               | `--md report.md`      |
| `output`, `o`, `out`        | `out.md`            | Output filename, the extension will change depending on the                     | `-o report.html`      |
| `outform`, `ofrm`           | `IO_FORMS.MD`       | Output file format for `--output`                                               | `--ofrm html`         |
| `beautify`,                 | `false`             | Specifies whether to beautify the output HTML (if applicable)                   | `--beautify`          |
| `remote`, `r`               | `origin`            | Specifies default name for remote                                               | `-r my-remote`        |
| `config`, `c`               | `null`              | Specifies the location of the config file (generated with `-w`)                 | `-c ./config.json`    |
| `summaries`, `s`            | `false`             | Specifies if "Summaries" sections should be added per repo                      | `-s`                  |
| `default-config`, `dc`      | `false`             | Apply the default config file                                                   | `--dc`                |
| `commit-hash-length`, `chl` | `7`                 | Sets the commit hash length for the output                                      | `--chl`               |
| `ignore-errors`, `ign`      | `false`             | Specified if the git output parser should ignore invalid commit lines           | `--ign`               |
| `doc-title`, `t`, `title`   | `Organization name` | Document title for multi-repo reports                                           | `-t 'My title'`       |
| `long-commits`, `l`         | `false`             | Should the output contain single line or multi-line commits                     | `-l`                  |
| `filter-patterns`, `p`      | `[]`                | Specify one or more pattern by which to filter (remove) commits from the report | `-p '*jenkins*'`      |
| `write-default-config`, `w` | `false`             | Apply the changes in the CLI options and write to the default config file       | `-w`                  |

## Examples

Generate an HTML report of three repos with commits from 14 days ago till now.

```sh
$ changelog-thing \
    -a 14 ./project-1 ./project-2 ./project-3 \
    --title "My big ol report" --outform html
HTML written to $PWD/out.html
```

Generate the same report but in markdown with placeholders for summaries, then convert that MD to an HTML report.

```sh
$ changelog-thing \
    -a 14 ./project-1 ./project-2 ./project-3 \
    --summaries --title "My big ol report" --outform md
MD written to $PWD/out.md

# Edit 'out.md' and add some nice summaries
# Now, convert the updated MD to HTML

$ changelog-thing --md-to-html out.md
HTML written to $PWD/out.html
```

<!-- markdownlint-disable-file MD013 -->
<!-- vim: set conceallevel=0: -->
