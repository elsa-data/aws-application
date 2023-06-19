#!/bin/bash

# This will download a lite version of MaxMind City Database (`.mmdb`) from UMCCR bucket. This is will require a proper permission to download it.

# To execute: bash get-mmdb-from-s3.sh

aws s3 cp s3://elsadatademoaustraliange-tempprivatebucket3b80855-12iwm3jf7qrl2/GeoLite2-City.mmdb GeoLite2-City.mmdb
