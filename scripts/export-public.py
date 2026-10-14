"""Copy reviewed working files to a new directory, without Git history or secrets.

This is a preparation tool, not an uploader or a complete privacy/security audit.
"""

import argparse
import fnmatch
import pathlib
import re
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
ROOT_FILES = {
    ".gitignore", ".npmrc", ".replit", ".replitignore", ".env.example",
    ".public-exportignore", "README.md", "package.json", "pnpm-workspace.yaml",
    "pnpm-lock.yaml", "tsconfig.json", "tsconfig.base.json",
}
SOURCE_DIRS = {"artifacts", "lib", "scripts", "docs", "attached_assets"}
ARTIFACTS = {
    "api-server", "voice-kiosk", "voice-kiosk-deck", "voice-kiosk-demo",
    "voice-kiosk-promo", "mockup-sandbox",
}
SENSITIVE_NAME = re.compile(
    r"(?i)(?:^|/)(?:\.env(?:$|\.(?!(?:[^/]+\.)?example$))|\.envrc$|\.netrc$|"
    r"\.git-credentials$|credentials\.json$|service-account[^/]*\.json$|"
    r"id_(?:rsa|ed25519)[^/]*$)|"
    r"\.(?:pem|key|p12|pfx|dump|sql|sqlite3?|db|log)$|\.sql\.(?:gz|zip)$"
)
SECRET_PATTERNS = {
    "provider-token": re.compile(
        rb"(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|"
        rb"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
        rb"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
        rb"AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,})"
    ),
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY"),
    "credential-url": re.compile(
        rb"(?:postgres(?:ql)?|mysql|redis|https?)://[^\s\"'<>/:]+:[^\s\"'<>@]+@"
    ),
    "jwt": re.compile(rb"\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}"),
}


def git(root, *args, input_bytes=None, allowed_codes=(0,)):
    result = subprocess.run(
        ["git", *args], cwd=root, input=input_bytes, capture_output=True, check=False,
    )
    if result.returncode not in allowed_codes:
        # Do not echo captured content, which might contain confidential paths/data.
        raise RuntimeError("Git inventory command failed; export stopped.")
    return result.stdout


def public_paths(root):
    listed = git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    paths = sorted(set(listed.decode().strip("\0").split("\0")) - {""})
    # --no-index also excludes files which were tracked before adding .gitignore.
    ignored = git(
        root, "check-ignore", "--no-index", "-z", "--stdin",
        input_bytes=listed, allowed_codes=(0, 1),
    )
    ignored_paths = set(ignored.decode().split("\0"))
    patterns = [
        line.strip() for line in (root / ".public-exportignore").read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    included, excluded = [], []
    for path in paths:
        allowed = path in ROOT_FILES or pathlib.PurePosixPath(path).parts[0] in SOURCE_DIRS
        if not allowed or path in ignored_paths or any(fnmatch.fnmatchcase(path, p) for p in patterns):
            excluded.append(path)
        else:
            included.append(path)
    return included, excluded


def validate(root, paths):
    required = ROOT_FILES | {"scripts/post-merge.sh", "docs/public-release.md", "lib/api-spec/openapi.yaml",
                             "lib/db/drizzle.config.ts", "lib/db/src/schema/index.ts"}
    for artifact in ARTIFACTS:
        required |= {f"artifacts/{artifact}/package.json",
                     f"artifacts/{artifact}/.replit-artifact/artifact.toml"}
    missing = required - set(paths)
    if missing:
        raise RuntimeError("Required public files missing: " + ", ".join(sorted(missing)))
    total = 0
    for path in paths:
        source = root / path
        # Reject all symlinks (including directory ancestors) and special Git entries.
        if any(p.is_symlink() for p in [source, *source.parents]) or not source.is_file():
            raise RuntimeError(f"Non-regular source rejected: {path}")
        if SENSITIVE_NAME.search(path):
            raise RuntimeError(f"Sensitive filename rejected: {path}")
        size = source.stat().st_size
        if size >= 50 * 1024 * 1024:
            raise RuntimeError(f"Large file requires separate storage review: {path}")
        data = source.read_bytes()
        for category, pattern in SECRET_PATTERNS.items():
            if pattern.search(data):
                # Report the category and path, never the matched value.
                raise RuntimeError(f"Possible {category} in {path}; export stopped.")
        total += size
    return total


def export(root, destination):
    root = root.resolve()
    destination = destination.absolute()
    if destination.exists() or destination.is_symlink():
        raise RuntimeError("Destination already exists; nothing will be overwritten.")
    resolved = destination.resolve()
    if resolved == root or root.is_relative_to(resolved):
        raise RuntimeError("Destination must not contain or replace the source.")
    if resolved.is_relative_to(root) and not resolved.is_relative_to(root / "generated-artifacts"):
        raise RuntimeError("In-workspace exports must be under generated-artifacts.")
    paths, excluded = public_paths(root)
    total = validate(root, paths)
    destination.mkdir(parents=True, exist_ok=False)
    for path in paths:
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / path, target)
    # Recheck copied bytes too; callers must inspect the copy before committing.
    validate(destination, paths)
    print(f"Copied {len(paths)} files ({total:,} bytes), without Git history.")
    for path in excluded:
        print(f"Excluded: {path}")
    print("No repository, remote or public upload was created.")
    return paths


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=pathlib.Path)
    args = parser.parse_args()
    try:
        export(ROOT, args.destination)
    except (RuntimeError, OSError) as error:
        parser.exit(1, f"{error}\n")
