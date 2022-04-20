#!/bin/bash

TAG_NAME="Name"
INSTANCE_ID="`wget -qO- http://instance-data/latest/meta-data/instance-id`"
REGION="`wget -qO- http://instance-data/latest/meta-data/placement/availability-zone | sed -e 's:\([0-9][0-9]*\)[a-z]*\$:\\1:'`"

apt update
apt upgrade -y
snap install core; snap refresh core

wget -P /etc/skel https://gist.githubusercontent.com/ciberado/601b0fad4d3eea3a086124aa68942830/raw/8154c6dfc5429aa7c0bf077fa36c8f259526a366/.tmux.conf
wget -P /etc/skel https://gist.githubusercontent.com/ciberado/601b0fad4d3eea3a086124aa68942830/raw/8154c6dfc5429aa7c0bf077fa36c8f259526a366/.tmux.conf.local
 
cat << EOF >> /etc/skel/.tmux.conf
set -g status-interval 1
set -g status-right '%H:%M:%S'
EOF

cp /etc/skel/* /home/ubuntu/
chown -R ubuntu /home/ubuntu/

R53_ZONE=YOUR_R53_ZONE_ID___________________________________________
PUBLIC_IP=$(curl http://169.254.169.254/latest/meta-data/public-ipv4)
# WORKSTATION_NAME="`aws ec2 describe-tags --filters "Name=resource-id,Values=$INSTANCE_ID" "Name=key,Values=$TAG_NAME" --region $REGION --output=text | cut -f5`"
WORKSTATION_NAME=dirtyrss
DOMAIN=YOUR_DOMAIN__________________________________________________

cat << EOF > dns.json
{
   "Changes":[
      {
         "Action":"UPSERT",
         "ResourceRecordSet":{
            "Name":"$WORKSTATION_NAME.$DOMAIN",
            "Type":"A",
            "TTL":300,
            "ResourceRecords":[
               {
                  "Value":"$PUBLIC_IP"
               }
            ]
         }
      }
   ]
}
EOF

apt install awscli -y
aws route53 change-resource-record-sets \
  --hosted-zone-id $R53_ZONE \
  --change-batch file://dns.json
 

apt install ffmpeg -y

iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 3000

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" 
nvm install --lts

git clone https://github.com/ciberado/dirtyrss
cd dirtyrss
npm i
npm run tsc
npm run start
