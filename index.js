#!/usr/bin/env node
'use strict'

var cluster = require('cluster');
var fs = require('fs');
var log4js = require('log4js');
var os = require('os');
var aws = require('aws-sdk');
var nodemailer = require('nodemailer');
var smtpTransport = require('nodemailer-smtp-transport');


log4js.configure({
  appenders: [
    { type: 'console' },
    { type: 'file', filename: 'logs/log.txt', maxLogSize: 200000, backups: 20}
  ],replaceConsole: true
});

var logger = log4js.getLogger('log-manager');
logger.setLevel('DEBUG');


//constants
var CONFIG = null;
var NUMBER_OF_CPUS = os.cpus().length;
var IN_MEM_LOGS = "";
var LOG_FILE_PATH = "log-sync/temp.txt";
//constants

loadConfig();


function startCluster(){
    if(CONFIG.isProduction)
        logger.setLevel('ERROR');
        
    if (cluster.isMaster) {
        
        logger.debug("Master thread started. Creating cluster.");
        
        // Fork workers.
        for (var i = CONFIG.NumOfFreeCpus; i < NUMBER_OF_CPUS ; i++) {
            cluster.fork();
        }
    
        cluster.on('exit', function(worker, code, signal) {
            logger.fatal('worker ' + worker.process.pid + ' died');
        });
        
        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].on('message', clusterMessageHandler);
        });
        
        var syncIntervalId = setInterval(function(){saveInMemoryLogToFile();}, CONFIG.inMemLogFlushInterval);
        
        aws.config.update({ accessKeyId: CONFIG.awsAccessKey, secretAccessKey: CONFIG.awsSecretKey });
        aws.config.region = CONFIG.awsRegion;
        
        
    }else{
        litenForLogs();
    }
    
    process.on('uncaughtException', function(err) {
            // handle the error safely
            logger.error(err);
            
    });
    
    
}


function litenForLogs(){
    
    var dgram = require('dgram');
    var server = dgram.createSocket('udp4');
    
    server.on('listening', function () {
        var address = server.address();
        logger.debug('UDP Server listening on ' + address.address + ":" + address.port);
    });
    
    server.on('message', function (message, remote) {
        //logger.debug(message+'');
        var msg = message+'';
        process.send(msg);
        executeActions(msg);
    });
    
    server.bind({
        address: CONFIG.liteningIp,
        port: CONFIG.udpPort,
        exclusive: true
    });
}


function loadConfig(){
    fs.readFile("config.json", "utf8", function (error, data) {
        if(error !=null)
        {
            logger.fatal('Error reading config file ->' + error )
        }else{
            //console.log(data);
            try{
                CONFIG = JSON.parse(data);
                startCluster();
            }
            catch(ex){
                logger.fatal('Error parsing config file, make sure json is valid -> ' + ex);
            }
            
        }
    });
}

function clusterMessageHandler(msg) {
    logger.debug('got worker message: '+ msg);
    IN_MEM_LOGS += "\n"+msg;
}

function saveInMemoryLogToFile(){
   logger.debug('flushing inMemory logs');
    fs.stat(LOG_FILE_PATH, function(err, stats){
        if(err && err.code!=="ENOENT"){
            logger.error(err);
        }else{
            var pastDate = new Date().getTime() - 60000;
            if(stats && (stats.size>= CONFIG.s3LogFileMaxSizeBytes || (stats.size>=0 && stats.mtime.getTime() <= pastDate))){
                logger.debug('temp log file max size reached.');
                var newFileName = "log-sync/syncme"+randomIntFromInterval(10000, 99999)+".txt";
                fs.renameSync(LOG_FILE_PATH, newFileName);
                setImmediate(syncLogWithS3(newFileName));
            }
            var data = IN_MEM_LOGS;
            IN_MEM_LOGS = "";
            
            if(data && data!==""){
                fs.appendFile(LOG_FILE_PATH, data, function(err){
                    if(err)
                        logger.error(err);
                });
            }
        }
    });
    
}

function syncLogWithS3(filename){
    logger.debug('syncing wih s3 file:'+filename);
    fs.readFile(filename, function (err, data) {
        if (err) {
            logger.error(err);
        }else{
            var utcDate = getUtcTime();
            var monthlyFolderName = utcDate.getFullYear() +"-"+ utcDate.getMonth()+ "-"+ utcDate.getDate();
            var s3Filename= CONFIG.awsS3LogFolder + "/" + monthlyFolderName +"/" + JSON.stringify(utcDate).replace(/"/g,"") + "_" + randomIntFromInterval(10000,99999) + ".txt";
            var s3 = new aws.S3();
            s3.putObject({
                Bucket: CONFIG.awsS3Bucket,
                Key: s3Filename,
                Body: data
            },function (err) {
                if(err)
                    logger.error(err);
                else
                    fs.unlink(filename, function(err){
                        if(err)
                            logger.error(err);
                    });
            });
        }
  
  });
}

function randomIntFromInterval(min,max)
{
    return Math.floor(Math.random()*(max-min+1)+min);
}

function getUtcTime(){
    var now = new Date(); 
    var now_utc = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),  now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
    return now_utc;
}

function executeActions(logMsg){
    if(logMsg && logMsg!==""){
        for(var i=0; i<CONFIG.actions.length; i++){
            var action = CONFIG.actions[i];
            if(logMsg.match(new RegExp(action.expression))){
                logger.debug('executing action '+ action);
                if(action.type ==="email"){
                    setImmediate(sendMail(action.subject, logMsg, action.to, CONFIG.smtp));
                }
            }
        }
    }
}

function sendMail(subject, msg, to, smtpSettings){
    logger.debug('sending mail');
    var transporter = nodemailer.createTransport(smtpTransport({
        host: smtpSettings.host,
        port: smtpSettings.port,
        auth: {
                user: smtpSettings.username,
                pass: smtpSettings.password
            }
        }));
    
    logger.debug(smtpSettings.host);
    
    transporter.sendMail({
        from: smtpSettings.from,
        to: to,
        subject: subject,
        text: msg
    }, function(err, info){
            if(err)
                logger.error(err);
            logger.debug(info);
        });
}