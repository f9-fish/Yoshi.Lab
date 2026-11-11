'use strict';
const PRODUCTION_IDS=Object.freeze(['1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU','1ON-F_R4CENHAS8fJ-V74ko75qSIJKl_QqRri4MO56lw']);
const TABS=Object.freeze({qa:'英C本文QA',writing:'英作文問題',trueFalse:'AI発展教材下書き'});
function fault(code,message){return Object.assign(Error(message),{code});}
function checkTarget(id,allowed){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(id)||PRODUCTION_IDS.includes(id)||!allowed.includes(id))throw fault(403,'本番または未承認の書き込み先です');}
module.exports={PRODUCTION_IDS,TABS,fault,checkTarget};
