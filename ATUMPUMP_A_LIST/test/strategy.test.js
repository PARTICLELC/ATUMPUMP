import test from 'node:test';
import assert from 'node:assert/strict';
import { fibonacciGoldenRatio } from '../src/engine/strategy.js';

test('golden ratio is 61.8 percent retracement from high',()=>{
  assert.equal(fibonacciGoldenRatio(100,200),138.2);
});
test('invalid swing is rejected',()=>{
  assert.equal(fibonacciGoldenRatio(200,100),null);
});
