Code a web based "Starship Architect” app 
On loading allow the user to select a .csv file as input with 4 columns, first line labels them (Category, Item, Tons, Cost) with category optional - the first in a given category uses it, the following items with empty category are the same as the first listed category. The last line (category is total) has the total tonnage and cost.

In game terms, 1 ton of displacement equals 14 square meters. Assuming 2.5 meter ceilings, the total floor area in square meters for a ship is (total tons)*14/2.5 ; so 1000 tons has 5600 square meters of floor space; divided into 4 equal floors, each floor has 1400 square meters, so any length and width that multiplies to 1400 (20 x 70, 40 x 35, 140 x 10, etc.) could be used for the dimensions of every floor.

The main UI shows the total tons and total cubic meters and has a “number of floors” slider.
Below that there’s a “nn square meters per floor” line with default value = the nearest multiple of ten below the square root of the total for the floor, if 0 then use minimum of 5, so for the example above (1400 per floor, square root is 37.416… nearest multiple of ten below that is 30, since the area length x width = = 30 x width = 1400, we can calculate width = 1400/30 = 46.6 meters, so our ship has four 30 x 46.6 meter floors. .

The UI would put 4 lines like this:
Floor 1   30 x 46.6 meters, 2.5 meters tall
Floor 2   30 x 46.6 meters, 2.5 meters tall
Floor 3   30 x 46.6 meters, 2.5 meters tall
Floor 4   30 x 46.6 meters, 2.5 meters tall
