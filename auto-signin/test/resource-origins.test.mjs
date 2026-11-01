import test from 'node:test';import assert from 'node:assert/strict';import * as engine from '../scripts/lib/engine.mjs';
test('resource-only login dependencies never authorize top-level or iframe navigation',()=>{
 assert.equal(typeof engine.isAllowedProtectedRequest,'function');
 const p={allowedOrigins:['https://login.example.test'],allowedResourceOrigins:['https://cdn.example.test']};
 assert.equal(engine.isAllowedProtectedRequest(p,'https://cdn.example.test',false),true);
 assert.equal(engine.isAllowedProtectedRequest(p,'https://cdn.example.test',true),false);
 assert.equal(engine.isAllowedProtectedRequest(p,'https://untrusted.invalid',false),false);
 assert.equal(engine.isAllowedProtectedRequest(p,'https://login.example.test',true),true);
});
