#!/usr/bin/env python3
"""Create a small, verified COPY/LITERAL update without changing the original EXE."""
import argparse, hashlib, json, mmap, zlib
from pathlib import Path


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def build(source, target, output, block=32768):
    output.mkdir(parents=True, exist_ok=True)
    operations, copied, literal_size = [], 0, 0
    with source.open('rb') as sf, target.open('rb') as tf, mmap.mmap(sf.fileno(), 0, access=mmap.ACCESS_READ) as old, mmap.mmap(tf.fileno(), 0, access=mmap.ACCESS_READ) as new, (output/'literal.bin').open('wb') as payload:
        index = {}
        for offset in range(0, len(old)-block+1, block):
            index.setdefault(zlib.adler32(old[offset:offset+block]), []).append(offset)
        position = pending = 0
        checksum = zlib.adler32(new[:block]) if len(new) >= block else 0
        while position+block <= len(new):
            match = next((o for o in index.get(checksum, []) if old[o:o+block] == new[position:position+block]), None)
            if match is not None:
                if pending < position:
                    data = new[pending:position]; payload.write(data)
                    operations.append([1, literal_size, len(data)]); literal_size += len(data)
                if operations and operations[-1][0] == 0 and operations[-1][1]+operations[-1][2] == match:
                    operations[-1][2] += block
                else:
                    operations.append([0, match, block])
                copied += block; position += block; pending = position
                checksum = zlib.adler32(new[position:position+block]) if position+block <= len(new) else 0
            else:
                if position+block == len(new):
                    position += 1
                    break
                a = ((checksum & 65535)-new[position]+new[position+block]) % 65521
                b = ((checksum >> 16)-block*new[position]+a-1) % 65521
                checksum = (b << 16) | a; position += 1
        if pending < len(new):
            data = new[pending:]; payload.write(data); operations.append([1, literal_size, len(data)]); literal_size += len(data)
    result = {'format':'FOLAX-COPY-LITERAL-v1', 'source':{'name':source.name,'size':source.stat().st_size,'sha256':digest(source)}, 'target':{'name':target.name,'size':target.stat().st_size,'sha256':digest(target)}, 'payload':{'file':'literal.bin','size':literal_size,'sha256':digest(output/'literal.bin')}, 'operations':operations}
    (output/'patch.json').write_text(json.dumps(result, separators=(',',':'))+'\n')
    # Reconstruct into a streaming digest before distributing the patch.
    check=hashlib.sha256(); size=0
    with source.open('rb') as original, (output/'literal.bin').open('rb') as literals:
        for kind, offset, length in operations:
            stream = original if kind == 0 else literals; stream.seek(offset); remaining=length
            while remaining:
                data=stream.read(min(1024*1024,remaining))
                if not data: raise ValueError('Truncated patch')
                check.update(data); size+=len(data); remaining-=len(data)
    assert size == result['target']['size'] and check.hexdigest() == result['target']['sha256']
    print(json.dumps({'copiedBytes':copied,'literalBytes':literal_size,'operations':len(operations),'sourceSHA256':result['source']['sha256'],'targetSHA256':result['target']['sha256'],'reconstructionVerified':True},indent=2))


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--target',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--block',type=int,default=32768);a=p.parse_args();build(a.source,a.target,a.output,a.block)
