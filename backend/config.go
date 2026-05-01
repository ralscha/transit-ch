package main

import (
	"flag"
	"fmt"
	"os"
	"strconv"
)

const defaultPort = 34341

func parsePort(args []string) (int, error) {
	flagSet := flag.NewFlagSet("transit-ch-backend", flag.ContinueOnError)
	flagSet.SetOutput(os.Stderr)

	portFlag := flagSet.Int("port", defaultPort, "HTTP port")

	if err := flagSet.Parse(args); err != nil {
		return 0, err
	}

	port := *portFlag
	extraArgs := flagSet.Args()

	if len(extraArgs) > 1 {
		return 0, fmt.Errorf("expected at most one positional port argument")
	}

	if len(extraArgs) == 1 {
		parsedPort, err := strconv.Atoi(extraArgs[0])
		if err != nil {
			return 0, fmt.Errorf("positional port must be an integer: %w", err)
		}
		port = parsedPort
	}

	if port < 1 || port > 65535 {
		return 0, fmt.Errorf("port must be between 1 and 65535")
	}

	return port, nil
}
