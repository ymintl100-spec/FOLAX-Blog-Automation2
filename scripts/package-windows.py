#!/usr/bin/env python3
"""Bundle the built Windows app and a ready-to-load Chrome extension together."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--guide', required=True, type=Path)
    parser.add_argument('--readme', required=True, type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    package = json.loads((repo / 'package.json').read_text())
    exe = repo / 'dist' / ('Naver-Blog-Automator-' + package['version'] + '.exe')
    app = repo / 'dist/win-unpacked/resources/app'
    extension = repo / 'extension'
    manifest = json.loads((extension / 'manifest.json').read_text())
    built_extension = repo / 'dist/win-unpacked/resources/extension'
    if json.loads((app / 'package.json').read_text())['version'] != package['version']:
        raise ValueError('Build the current version before packaging')
    for file in extension.rglob('*'):
        if file.is_file() and file.read_bytes() != (built_extension / file.relative_to(extension)).read_bytes():
            raise ValueError('Built extension differs from source: ' + str(file))
    for file in (repo / 'src').rglob('*'):
        if file.is_file() and file.read_bytes() != (app / file.relative_to(repo)).read_bytes():
            raise ValueError('Built app differs from source: ' + str(file))
    for forbidden in ['runtime', 'tests', 'docs']:
        if (app / forbidden).exists():
            raise ValueError('Build contains user/test data: ' + forbidden)
    # Keep this folder name stable so Chrome's unpacked-extension path can be
    # reused across updates. Users should keep the extracted folder in place.
    members = [(exe, exe.name), (args.guide, args.guide.name), (args.readme, 'README.txt')]
    members += [(file, 'Chrome-Extension/' + file.relative_to(extension).as_posix())
                for file in sorted(extension.rglob('*')) if file.is_file()]
    args.output.mkdir(parents=True, exist_ok=True)
    archive = args.output / 'Naver-Blog-Automator-Windows-x64.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for file, name in members:
            bundle.write(file, name)
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise ValueError('Corrupt ZIP')
        if set(bundle.namelist()) != {name for _, name in members}:
            raise ValueError('Unexpected ZIP contents')
        for file, name in members:
            with bundle.open(name) as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != digest(file):
                    raise ValueError('ZIP content differs from source: ' + name)
        if json.loads(bundle.read('Chrome-Extension/manifest.json')) != manifest:
            raise ValueError('Extension manifest mismatch')
    parts = []
    with archive.open('rb') as stream:
        while data := stream.read(8 * 1024 * 1024):
            name = archive.name + '.part' + str(len(parts) + 1).zfill(3)
            (args.output / name).write_bytes(data)
            parts.append({'name': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    download = {'file': archive.name, 'sha256': digest(archive), 'size': archive.stat().st_size, 'parts': parts}
    (args.output / 'windows-manifest.json').write_text(json.dumps(download, indent=2) + '\n')
    (args.output / 'SHA256SUMS.txt').write_text(download['sha256'] + '  ' + archive.name + '\n' + ''.join(
        p['sha256'] + '  ' + p['name'] + '\n' for p in parts))
    print(json.dumps({'appVersion': package['version'], 'extensionVersion': manifest['version'],
        'extensionFolder': 'Chrome-Extension', 'filesVerified': len(members), 'parts': len(parts),
        'archiveSha256': download['sha256'], 'exeSha256': digest(exe)}, indent=2))


if __name__ == '__main__':
    main()
