<?php

declare(strict_types=1);

require __DIR__ . '/src/Greeter.php';

echo (new Greeter())->greet('world');
