import sys

from genvm_linter.lint import safety
from genvm_linter.cli import main


safety.SafeEntryPointFinder.SAFE_PATTERNS["gl.vm.run_nondet_default"] = [0, 1]
safety.NONDET_SPAWN_CALLS = safety.NONDET_SPAWN_CALLS | {"gl.vm.run_nondet_default"}

if __name__ == "__main__":
    sys.exit(main())
