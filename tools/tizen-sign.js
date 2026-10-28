// Tizen widget signer (W3C XML Digital Signatures for Widgets profile).
// Usage: node tizen-sign.js <dir> <keyPem> <certChainPem> <author|distributor> [files...]
// Writes author-signature.xml or signature1.xml into <dir>. XML is emitted
// already in canonical form so the hashed bytes equal the document text.
var fs = require('fs'), crypto = require('crypto'), path = require('path');
var dir = process.argv[2], keyPem = fs.readFileSync(process.argv[3], 'utf8');
var chain = fs.readFileSync(process.argv[4], 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
var role = process.argv[5], files = process.argv.slice(6);
var DS = 'http://www.w3.org/2000/09/xmldsig#';
var id = role === 'author' ? 'AuthorSignature' : 'DistributorSignature';
var outName = role === 'author' ? 'author-signature.xml' : 'signature1.xml';
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('base64'); }
function attr(s) { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

var props = '<SignatureProperties xmlns:dsp="http://www.w3.org/2009/xmldsig-properties">' +
  '<SignatureProperty Id="profile" Target="#' + id + '"><dsp:Profile URI="http://www.w3.org/ns/widgets-digsig#profile"></dsp:Profile></SignatureProperty>' +
  '<SignatureProperty Id="role" Target="#' + id + '"><dsp:Role URI="http://www.w3.org/ns/widgets-digsig#role-' + role + '"></dsp:Role></SignatureProperty>' +
  '<SignatureProperty Id="identifier" Target="#' + id + '"><dsp:Identifier></dsp:Identifier></SignatureProperty>' +
  '</SignatureProperties>';
// c14n 1.1 of the Object subset renders the inherited default namespace on Object
var objCanon = '<Object xmlns="' + DS + '" Id="prop">' + props + '</Object>';
var objDoc = '<Object Id="prop">' + props + '</Object>';

function signedInfo(nsDecl) {
  var s = '<SignedInfo' + nsDecl + '>' +
    '<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod>' +
    '<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod>';
  files.forEach(function (f) {
    s += '<Reference URI="' + attr(encodeURI(f)) + '"><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod>' +
      '<DigestValue>' + sha(fs.readFileSync(path.join(dir, f))) + '</DigestValue></Reference>';
  });
  s += '<Reference URI="#prop"><Transforms><Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></Transform></Transforms>' +
    '<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod><DigestValue>' + sha(Buffer.from(objCanon, 'utf8')) + '</DigestValue></Reference>';
  return s + '</SignedInfo>';
}
var sigValue = crypto.sign('sha256', Buffer.from(signedInfo(' xmlns="' + DS + '"'), 'utf8'), keyPem).toString('base64');
var certs = chain.map(function (c) { return '<X509Certificate>' + c.replace(/-----[A-Z ]+-----|\s/g, '') + '</X509Certificate>'; }).join('');
var xml = '<Signature xmlns="' + DS + '" Id="' + id + '">' + signedInfo('') +
  '<SignatureValue>' + sigValue + '</SignatureValue>' +
  '<KeyInfo><X509Data>' + certs + '</X509Data></KeyInfo>' + objDoc + '</Signature>';
fs.writeFileSync(path.join(dir, outName), xml);
console.log('wrote ' + outName + ' (' + files.length + ' file refs)');
