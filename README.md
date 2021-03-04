# Changelog Thing

<!-- markdownlint-disable MD013 -->

Similar to [conventional-changelog-cli](https://www.npmjs.com/package/conventional-changelog-cli) but collecting commits from a particular number of days ago till now.

Some of the pipelines used at my place of work make unholy use of tags, this doesn't play too well with the package above which looks for the "previous release" based on the semver in a repo's tags.

This is a cobbled together solution which can generate one report for multiple projects since _n_ days ago (say, a sprint's worth, fourteen or so).

## Usage

| Option                      | Default             | Description                                                                          | Example               |
| ---                         | ---                 | ---                                                                                  | ---                   |
| `help`, `h`                 | `false`             | Show cli help information                                                            | `-h`                  |
| `dir`, `d`                  | `['.']`             | Specify one or more directories to generate reports for                              | `-d repo-1 -d repo-2` |
| `age`, `a`                  | `14`                | Gather commits from _n_ days ago                                                     | `-a 14`               |
| `input`, `i`, `in`          | `null`              | Input file for use only when converting a report from a previous run of this program | `-i report.json`      |
| `inform`, `ifrm`            | `null`              | Input file format for `--input`                                                      | `--infrm json`        |
| `output`, `o`, `out`        | `out.md`            | Output filename, the extension will change depending on the                          | `-o report.html`      |
| `outform`, `ofrm`           | `IO_FORMS.MD`       | Output file format for `--output`                                                    | `--ofrm html`         |
| `beautify`,                 | `false`             | Specifies whether to beautify the output HTML (if applicable)                        | `--beautify`          |
| `remote`, `r`               | `origin`            | Specifies default name for remote                                                    | `-r my-remote`        |
| `config`, `c`               | `null`              | Specifies the location of the config file (generated with `-w`)                      | `-c ./config.json`    |
| `summaries`, `s`            | `false`             | Specifies if "Summaries" sections should be added per repo                           | `-s`                  |
| `ignore-errors`, `ign`      | `false`             | Specified if the git output parser should ignore invalid commit lines                | `--ign`               |
| `write-html`, `html`        | `false`             | Should the program output HTML regardless of `--outform`                             | `--html`              |
| `write-json`, `json`        | `false`             | Should the program output JSON regardless of `--outform`                             | `--json`              |
| `doc-title`, `t`, `title`   | `Organization name` | Document title for multi-repo reports                                                | `-t 'My title'`       |
| `long-commits`, `l`         | `false`             | Should the output contain single line or multi-line commits                          | -l                    |
| `filter-patterns`, `p`      |                     | Specify one or more pattern by which to filter (remove) commits from the report      | `-p '*jenkins*'`      |
| `write-default-config`, `w` | `false`             | Apply the changes in the CLI options and write to the default config file            | `-w`                  |

## Examples

Generate an HTML report of three repos with commits from 14 days ago till now.

```sh
$ changelog-thing \
    -a 14 -d ./project-1 -d ./project-2 -d ./project-3 \
    --title "My big ol report" --outform html
HTML written to $PWD/out.html
```

Generate the same report but in markdown with placeholders for summaries, then convert that MD to an HTML report.

```sh
$ changelog-thing \
    -a 14 -d ./project-1 -d ./project-2 -d ./project-3 \
    --summaries --title "My big ol report" --outform md
MD written to $PWD/out.md

# Edit 'out.md' and add some nice summaries
# Now, convert the updated MD to HTML

$ changelog-thing --inform md --input out.md --outform html
HTML written to $PWD/out.html
```

<!-- vim: set conceallevel=0 : -->
