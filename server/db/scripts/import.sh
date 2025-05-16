#!/bin/bash

# Configuration
DB_NAME="op.sqlite"
TABLE_NAME="cards"
CSV_DIR="./data/cards"

echo "Creating database and cards table..."
sqlite3 "$DB_NAME" "CREATE TABLE \"cards\" (
    \"id\" text,
    \"code\" text,
    \"rarity\" text,
    \"type\" text,
    \"name\" text,
    \"cost\" integer,
    \"power\" integer,
    \"counter\" text,
    \"color\" text,
    \"family\" text,
    \"ability\" text,
    \"trigger\" text,
    \"set_name\" text,
    \"image_url\" text,
    \"attribute_name\" text
);"

# Process each CSV file
echo "Importing CSV files..."
for csv_file in "$CSV_DIR"/*.csv; do
    if [ -f "$csv_file" ]; then
        filename=$(basename "$csv_file")
        echo "Processing $filename..."
        # Check if this is the first file we're processing
        if [ "$(sqlite3 "$DB_NAME" "SELECT COUNT(*) FROM $TABLE_NAME;")" -eq 0 ]; then
            # For the first file, we need to handle headers
            sqlite3 "$DB_NAME" <<EOF
.mode csv
.headers on
.import "$csv_file" temp_import
INSERT INTO $TABLE_NAME SELECT * FROM temp_import;
DROP TABLE temp_import;
EOF
        else
            # For subsequent files, skip the header row
            sqlite3 "$DB_NAME" <<EOF
.mode csv
.headers on
.import "$csv_file" temp_import
INSERT INTO $TABLE_NAME SELECT * FROM temp_import;
DROP TABLE temp_import;
EOF
        fi
    fi
done  

# Verify the import
row_count=$(sqlite3 "$DB_NAME" "SELECT COUNT(*) FROM $TABLE_NAME;")
echo "Import complete. Total rows in $TABLE_NAME: $row_count"