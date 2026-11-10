'use strict';
// Produces a reviewable file only. Does not contact or deploy to Firebase.
const fs=require('node:fs'),path=require('node:path');
function merge(existing,proposal){
 const result=structuredClone(existing);
 if(!result?.rules||!proposal?.rules?.pairQaSpark)throw Error('Rulesの構造を確認してください');
 if(result.rules['.read']!==false||result.rules['.write']!==false)throw Error('上位に包括的な許可があります。個別の統合レビューが必要です');
 if(result.rules.pairQaSpark)throw Error('既存のpairQaSparkを上書きできません');
 result.rules.pairQaSpark=structuredClone(proposal.rules.pairQaSpark);
 return result;
}
if(require.main===module){
 const source=process.argv[2],output=process.argv[3];
 if(!source||!output)throw Error('Usage: node scripts/merge-pair-qa-spark-rules.cjs existing.json output.json');
 const proposal=JSON.parse(fs.readFileSync(path.join(__dirname,'../pair-qa-spark.rules.proposed.json'),'utf8'));
 fs.writeFileSync(output,JSON.stringify(merge(JSON.parse(fs.readFileSync(source,'utf8')),proposal),null,2)+'\n');
}
module.exports={merge};
