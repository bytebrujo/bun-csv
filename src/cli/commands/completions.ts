/**
 * completions command - Generate shell completions
 */

const COMMANDS = [
  "count",
  "head",
  "tail",
  "select",
  "filter",
  "sort",
  "convert",
  "validate",
  "stats",
  "benchmark",
  "completions",
];

const GLOBAL_OPTIONS = [
  "--help",
  "--version",
  "--delimiter",
  "--encoding",
  "--no-header",
  "--format",
  "--color",
  "--no-color",
];

// Command-specific options are defined inline in completion generators

export function completions(shell: string): void {
  switch (shell.toLowerCase()) {
    case "bash":
      console.log(generateBashCompletions());
      console.error("\n# Add to ~/.bashrc or ~/.bash_profile:");
      console.error('# eval "$(turbocsv completions bash)"');
      break;

    case "zsh":
      console.log(generateZshCompletions());
      console.error("\n# Add to ~/.zshrc:");
      console.error('# eval "$(turbocsv completions zsh)"');
      break;

    case "fish":
      console.log(generateFishCompletions());
      console.error("\n# Save to ~/.config/fish/completions/turbocsv.fish");
      break;

    default:
      console.error(`Unknown shell: ${shell}`);
      console.error("Supported shells: bash, zsh, fish");
      process.exit(1);
  }
}

function generateBashCompletions(): string {
  return `# turbocsv bash completion
_turbocsv() {
    local cur prev words cword
    _init_completion || return

    local commands="${COMMANDS.join(" ")}"
    local global_opts="${GLOBAL_OPTIONS.join(" ")}"

    case $cword in
        1)
            COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
            ;;
        *)
            case \${words[1]} in
                head|tail)
                    COMPREPLY=( $(compgen -W "-n --number $global_opts" -- "$cur") )
                    ;;
                sort)
                    COMPREPLY=( $(compgen -W "-c --column --desc $global_opts" -- "$cur") )
                    ;;
                convert)
                    COMPREPLY=( $(compgen -W "--to --output $global_opts" -- "$cur") )
                    ;;
                benchmark)
                    COMPREPLY=( $(compgen -W "--iterations $global_opts" -- "$cur") )
                    ;;
                completions)
                    COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
                    ;;
                *)
                    COMPREPLY=( $(compgen -W "$global_opts" -f -- "$cur") )
                    ;;
            esac
            ;;
    esac
}
complete -F _turbocsv turbocsv
`;
}

function generateZshCompletions(): string {
  return `#compdef turbocsv

_turbocsv() {
    local -a commands
    commands=(
        'count:Count rows in CSV file'
        'head:Show first N rows'
        'tail:Show last N rows'
        'select:Select specific columns'
        'filter:Filter rows by condition'
        'sort:Sort rows by column'
        'convert:Convert between formats'
        'validate:Check CSV validity'
        'stats:Show column statistics'
        'benchmark:Measure parsing performance'
        'completions:Generate shell completions'
    )

    local -a global_opts
    global_opts=(
        '(-h --help)'{-h,--help}'[Show help message]'
        '(-v --version)'{-v,--version}'[Show version]'
        '(-d --delimiter)'{-d,--delimiter}'[Field delimiter]:delimiter:'
        '(-e --encoding)'{-e,--encoding}'[File encoding]:encoding:'
        '--no-header[File has no header row]'
        '--format[Output format]:format:(table csv json)'
        '--color[Force colored output]'
        '--no-color[Disable colored output]'
    )

    _arguments -C \\
        $global_opts \\
        '1: :->command' \\
        '*: :->args'

    case $state in
        command)
            _describe -t commands 'turbocsv commands' commands
            ;;
        args)
            case $words[2] in
                head|tail)
                    _arguments \\
                        '(-n --number)'{-n,--number}'[Number of rows]:number:' \\
                        '*:file:_files -g "*.csv"'
                    ;;
                sort)
                    _arguments \\
                        '(-c --column)'{-c,--column}'[Column to sort by]:column:' \\
                        '--desc[Sort descending]' \\
                        '*:file:_files -g "*.csv"'
                    ;;
                convert)
                    _arguments \\
                        '--to[Output format]:format:(csv tsv json jsonl)' \\
                        '--output[Output file]:file:_files' \\
                        '*:file:_files -g "*.csv"'
                    ;;
                benchmark)
                    _arguments \\
                        '--iterations[Number of iterations]:number:' \\
                        '*:file:_files -g "*.csv"'
                    ;;
                completions)
                    _arguments '1:shell:(bash zsh fish)'
                    ;;
                *)
                    _files -g "*.csv"
                    ;;
            esac
            ;;
    esac
}

_turbocsv "$@"
`;
}

function generateFishCompletions(): string {
  return `# turbocsv fish completion

# Disable file completion by default
complete -c turbocsv -f

# Commands
complete -c turbocsv -n "__fish_use_subcommand" -a count -d "Count rows in CSV file"
complete -c turbocsv -n "__fish_use_subcommand" -a head -d "Show first N rows"
complete -c turbocsv -n "__fish_use_subcommand" -a tail -d "Show last N rows"
complete -c turbocsv -n "__fish_use_subcommand" -a select -d "Select specific columns"
complete -c turbocsv -n "__fish_use_subcommand" -a filter -d "Filter rows by condition"
complete -c turbocsv -n "__fish_use_subcommand" -a sort -d "Sort rows by column"
complete -c turbocsv -n "__fish_use_subcommand" -a convert -d "Convert between formats"
complete -c turbocsv -n "__fish_use_subcommand" -a validate -d "Check CSV validity"
complete -c turbocsv -n "__fish_use_subcommand" -a stats -d "Show column statistics"
complete -c turbocsv -n "__fish_use_subcommand" -a benchmark -d "Measure parsing performance"
complete -c turbocsv -n "__fish_use_subcommand" -a completions -d "Generate shell completions"

# Global options
complete -c turbocsv -s h -l help -d "Show help message"
complete -c turbocsv -s v -l version -d "Show version"
complete -c turbocsv -s d -l delimiter -d "Field delimiter" -r
complete -c turbocsv -s e -l encoding -d "File encoding" -r
complete -c turbocsv -l no-header -d "File has no header row"
complete -c turbocsv -l format -d "Output format" -r -a "table csv json"
complete -c turbocsv -l color -d "Force colored output"
complete -c turbocsv -l no-color -d "Disable colored output"

# Command-specific options
complete -c turbocsv -n "__fish_seen_subcommand_from head tail" -s n -l number -d "Number of rows" -r
complete -c turbocsv -n "__fish_seen_subcommand_from sort" -s c -l column -d "Column to sort by" -r
complete -c turbocsv -n "__fish_seen_subcommand_from sort" -l desc -d "Sort descending"
complete -c turbocsv -n "__fish_seen_subcommand_from convert" -l to -d "Output format" -r -a "csv tsv json jsonl"
complete -c turbocsv -n "__fish_seen_subcommand_from convert" -l output -d "Output file" -r
complete -c turbocsv -n "__fish_seen_subcommand_from benchmark" -l iterations -d "Number of iterations" -r
complete -c turbocsv -n "__fish_seen_subcommand_from completions" -a "bash zsh fish" -d "Shell type"

# File completion for most commands
complete -c turbocsv -n "__fish_seen_subcommand_from count head tail select filter sort convert validate stats benchmark" -F -r
`;
}
