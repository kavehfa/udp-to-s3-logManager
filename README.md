# udp-to-s3-logManager
A UDP to AWS S3 log management application written in NodeJs. It also has support for executing actions like sending an email if a message matches a Regex.

How to Run:
install nodejs.
clone the repository.
run nom install inside cloned folder.
rename config-template.json to config.json
configure config.json
run node index.js


Config File:
```
{
    "NumOfFreeCpus":0, <- number of cpu cores you wish to keep free on your server
    "isProduction": false, <- set to true if production. this will set the local error logging to ERROR level.
    "liteningIp": "127.0.0.1", <- Ip address in which this server should listen to for UDP packets
    "udpPort":33333, <- UDP port
    "awsRegion":"region", 
    "awsAccessKey":"key", 
    "awsSecretKey":"secret",
    "awsS3Bucket":"your bucket name", <- bucket name for storing logs
    "awsS3LogFolder":"folder name. you can include / for subfolders",
    "s3LogFileMaxSizeBytes":10000,
    "inMemLogFlushInterval":10000, <- milliseconds for writing log messages from memory to file. 
    "smtp":{
            "username": "username",
            "password": "pass",
            "host":"smtp.gmail.com",
            "port":587,
            "sender":"your email"
    },
    "actions":[
        {"expression":"ERROR", "type":"email", "to":"email@email.com", "subject":"Error Report"}
    ]     
}
```
