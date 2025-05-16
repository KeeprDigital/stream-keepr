#!/bin/bash

for file in *.json; do
  echo "Converting $file to CSV..."
  jq -r '
    # Define the columns we want in order
    ["id", "code", "rarity", "type", "name", "cost", "power", "counter", "color", "family", "ability", "trigger", "set_name", "image_url", "attribute_name"] as $cols |

    # Output header row
    ($cols | @csv),

    # Output data rows with proper field mapping
    (.[] | [
      .id,
      .code,
      .rarity,
      .type,
      .name,
      .cost,
      .power,
      .counter,
      .color,
      .family,
      .ability,
      .trigger,
      (.set.name // ""),
      (.images.small // ""),
      (.attribute.name // "")
    ] | @csv)
  ' "$file" > "${file%.json}.csv"
  echo "✓ Created ${file%.json}.csv"
done