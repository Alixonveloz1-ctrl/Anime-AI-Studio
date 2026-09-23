import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {Sha256,fileHash} from '../../cortos/hash.mjs';
test('A045/A050 full checksum detects changed middle bytes, independent of chunks',async()=>{
 for(const size of [0,1,55,56,63,64,65,1000,4*1024*1024+13]){
  const input=randomBytes(size),hash=new Sha256();
  for(let i=0;i<input.length;i+=17)hash.update(input.subarray(i,i+17));
  const expected=createHash('sha256').update(input).digest('hex');
  assert.equal(hash.hex(),expected);assert.equal(await fileHash(new Blob([input])),expected);
 }
 const file=Buffer.alloc(200000);const before=await fileHash(new Blob([file]));file[100000]=1;assert.notEqual(await fileHash(new Blob([file])),before);
});
