import importlib.util
import pathlib
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "export_public", pathlib.Path(__file__).with_name("export-public.py"),
)
export_public = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export_public)


class PublicExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name) / "source"
        self.root.mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.put(".gitignore", ".env*\n!.env.example\nnode_modules/\ngenerated-artifacts/\n")
        self.put(".public-exportignore", ".agents/*\nreplit.md\nattached_assets/Pasted-*\n*.mp4\n")

    def put(self, path, content="safe"):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        return target

    def required_files(self):
        for path in export_public.ROOT_FILES - {".gitignore", ".public-exportignore"}:
            self.put(path)
        for path in ["scripts/post-merge.sh", "docs/public-release.md", "lib/api-spec/openapi.yaml",
                     "lib/db/drizzle.config.ts", "lib/db/src/schema/index.ts"]:
            self.put(path)
        for artifact in export_public.ARTIFACTS:
            self.put(f"artifacts/{artifact}/package.json")
            self.put(f"artifacts/{artifact}/.replit-artifact/artifact.toml")

    def test_tracked_ignored_material_is_still_excluded(self):
        self.put(".agents/internal.md")
        self.put("replit.md")
        self.put("attached_assets/Pasted-planning.txt")
        self.put("tuptalk.mp4")
        self.put("artifacts/voice-kiosk/.env", "TOKEN=not-public")
        self.put("artifacts/voice-kiosk/src/main.tsx")
        self.put("artifacts/voice-kiosk/public/logo.svg")
        self.put(".env.example", "TOKEN=")
        self.put("node_modules/cache.txt")
        subprocess.run(["git", "add", "--force", "."], cwd=self.root, check=True)
        paths, excluded = export_public.public_paths(self.root)
        self.assertIn("artifacts/voice-kiosk/src/main.tsx", paths)
        self.assertIn("artifacts/voice-kiosk/public/logo.svg", paths)
        self.assertIn(".env.example", paths)
        self.assertIn("artifacts/voice-kiosk/.env", excluded)
        self.assertNotIn(".agents/internal.md", paths)
        self.assertNotIn("node_modules/cache.txt", paths)
        self.assertNotIn("tuptalk.mp4", paths)

    def test_new_files_in_required_sources_are_included(self):
        self.put("lib/db/src/new.ts")
        self.assertIn("lib/db/src/new.ts", export_public.public_paths(self.root)[0])

    def test_missing_required_file_stops_export(self):
        with self.assertRaisesRegex(RuntimeError, "Required public files missing"):
            export_public.export(self.root, self.root.parent / "public")
        self.assertFalse((self.root.parent / "public").exists())

    def test_detected_secret_is_not_echoed(self):
        self.required_files()
        fake = "sk" + "-" + "A" * 40
        self.put("scripts/unsafe.ts", fake)
        with self.assertRaisesRegex(RuntimeError, "Possible provider-token") as caught:
            export_public.export(self.root, self.root.parent / "public")
        self.assertNotIn(fake, str(caught.exception))
        self.assertFalse((self.root.parent / "public").exists())

    def test_symlink_and_existing_destination_are_rejected(self):
        self.required_files()
        (self.root / "scripts/link.txt").symlink_to(self.root / "README.md")
        with self.assertRaisesRegex(RuntimeError, "Non-regular source rejected"):
            export_public.export(self.root, self.root.parent / "public")
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            export_public.export(self.root, self.root)

    def test_unignored_dump_is_rejected(self):
        self.required_files()
        self.put("docs/customer.sql")
        with self.assertRaisesRegex(RuntimeError, "Sensitive filename"):
            export_public.export(self.root, self.root.parent / "public")

    def test_copy_has_no_history_and_original_is_preserved(self):
        self.required_files()
        self.put(".agents/internal.md")
        destination = self.root.parent / "public"
        export_public.export(self.root, destination)
        self.assertTrue((destination / ".replit").exists())
        self.assertTrue((destination / ".env.example").exists())
        self.assertFalse((destination / ".git").exists())
        self.assertFalse((destination / ".agents").exists())
        self.assertTrue((self.root / ".agents/internal.md").exists())


if __name__ == "__main__":
    unittest.main()
