'use strict';
// The new-job configuration and its public guidance use the same values.
// Saved jobs retain their data; the requested advisory length policy also
// applies when resuming an older manuscript.
const options=Object.freeze({articleLengthPolicy:4,tagCount:15,maxAutoRetries:5,revisionPolicy:1,revisionProtocol:2,revisionEvidencePolicy:1,inputScopePolicy:1,allowDuplicateTopics:true,emphasisPolicy:1});
function summary(){return {...require('./articleRequirements').limits(options),tagCount:options.tagCount,maxAutoRetries:options.maxAutoRetries};}
module.exports={options,summary};
